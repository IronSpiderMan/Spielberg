#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>

typedef void (*SpielbergSpeechCallback)(const char *);

// Every state transition runs on the main queue; the audio tap only appends to
// its own request. Session identity discards late permission/task callbacks.
API_AVAILABLE(macos(10.15))
@interface SpielbergSpeech : NSObject
@property(nonatomic, copy) NSString *session;
@property(nonatomic, copy) NSString *transcript;
@property(nonatomic) SpielbergSpeechCallback callback;
@property(nonatomic, strong) AVAudioEngine *engine;
@property(nonatomic, strong) SFSpeechRecognizer *recognizer;
@property(nonatomic, strong) SFSpeechAudioBufferRecognitionRequest *request;
@property(nonatomic, strong) SFSpeechRecognitionTask *task;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic) BOOL hasTap;
@property(nonatomic) BOOL finishing;
@property(nonatomic) NSTimeInterval startedAt;
@property(nonatomic) NSTimeInterval changedAt;
@property(nonatomic) NSTimeInterval finishAt;
- (void)start:(NSString *)session locale:(NSString *)locale callback:(SpielbergSpeechCallback)callback;
- (void)stop:(BOOL)cancel;
@end

@implementation SpielbergSpeech
- (void)emit:(NSString *)type fields:(NSDictionary *)fields {
    if (!self.session || !self.callback) return;
    NSMutableDictionary *payload = [@{@"sessionId": self.session, @"type": type} mutableCopy];
    [payload addEntriesFromDictionary:fields ?: @{}];
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    if (text) self.callback(text.UTF8String);
}
- (void)haltAudio {
    if (self.engine.isRunning) [self.engine stop];
    if (self.hasTap) { [self.engine.inputNode removeTapOnBus:0]; self.hasTap = NO; }
}
- (void)complete:(BOOL)includeText {
    if (!self.session) return;
    [self haltAudio];
    [self.timer invalidate]; self.timer = nil;
    if (includeText && self.transcript.length) [self emit:@"result" fields:@{@"text": self.transcript, @"isFinal": @YES}];
    [self emit:@"ended" fields:nil];
    // Clear identity before cancelling, because Speech can call back on cancel.
    self.session = nil;
    [self.task cancel]; self.task = nil;
    self.request = nil; self.engine = nil; self.recognizer = nil;
    self.transcript = nil; self.finishing = NO;
}
- (void)fail:(NSString *)message {
    [self emit:@"error" fields:@{@"message": message}];
    [self complete:NO];
}
- (void)stop:(BOOL)cancel {
    if (!self.session) return;
    if (cancel || !self.request) { [self complete:NO]; return; }
    if (self.finishing) return;
    self.finishing = YES;
    self.finishAt = [NSDate timeIntervalSinceReferenceDate];
    [self haltAudio];
    [self.request endAudio];
    // Let Speech deliver final punctuation; the timer bounds service latency.
}
- (void)beginAudio:(NSString *)session {
    if (![self.session isEqualToString:session]) return;
    if (!self.recognizer.isAvailable) { [self fail:@"系统语音识别暂不可用，请检查网络或稍后重试"]; return; }
    self.engine = [[AVAudioEngine alloc] init];
    self.request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
    self.request.shouldReportPartialResults = YES;
    // Prefer the OS's on-device recognizer when that language is installed.
    self.request.requiresOnDeviceRecognition = self.recognizer.supportsOnDeviceRecognition;
    AVAudioInputNode *input = self.engine.inputNode;
    AVAudioFormat *format = [input outputFormatForBus:0];
    if (format.sampleRate <= 0 || format.channelCount == 0) { [self fail:@"没有可用的麦克风，请检查系统声音输入设置"]; return; }
    SFSpeechAudioBufferRecognitionRequest *request = self.request;
    [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
        [request appendAudioPCMBuffer:buffer];
    }];
    self.hasTap = YES;
    __weak SpielbergSpeech *weakSelf = self;
    self.task = [self.recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            SpielbergSpeech *owner = weakSelf;
            if (!owner || ![owner.session isEqualToString:session]) return;
            if (result) {
                NSString *text = result.bestTranscription.formattedString ?: @"";
                if (![text isEqualToString:owner.transcript]) owner.changedAt = [NSDate timeIntervalSinceReferenceDate];
                owner.transcript = text;
                if (result.isFinal) { [owner complete:YES]; return; }
                [owner emit:@"result" fields:@{@"text": text, @"isFinal": @NO}];
            }
            if (error) {
                if (owner.finishing && owner.transcript.length) [owner complete:YES];
                else [owner fail:@"语音识别已中断，请检查麦克风、网络后重试"];
            }
        });
    }];
    [self.engine prepare];
    NSError *error = nil;
    if (![self.engine startAndReturnError:&error]) { [self fail:@"无法启动麦克风，请检查系统声音输入设置"]; return; }
    self.startedAt = self.changedAt = [NSDate timeIntervalSinceReferenceDate];
    [self emit:@"started" fields:nil];
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.2 repeats:YES block:^(NSTimer *timer) {
        SpielbergSpeech *owner = weakSelf;
        if (!owner || ![owner.session isEqualToString:session]) { [timer invalidate]; return; }
        NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
        if (owner.finishing) { if (now - owner.finishAt >= 2.5) [owner complete:YES]; return; }
        if (!owner.transcript.length && now - owner.startedAt >= 10) { [owner fail:@"没有听到声音，请点击悬浮球重试"]; return; }
        if (now - owner.startedAt >= 45 || (owner.transcript.length && now - owner.changedAt >= 1.8)) [owner stop:NO];
    }];
}
- (void)start:(NSString *)session locale:(NSString *)locale callback:(SpielbergSpeechCallback)callback {
    if (self.session) {
        NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"sessionId": session, @"type": @"error", @"message": @"已有语音识别正在进行，请先停止"} options:0 error:nil];
        callback([[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] UTF8String]);
        return;
    }
    self.session = session; self.callback = callback; self.transcript = @"";
    // Missing usage descriptions cause a macOS privacy crash. Keep a useful
    // error for an unbundled/custom dev binary instead of requesting access.
    NSBundle *bundle = NSBundle.mainBundle;
    if (![bundle objectForInfoDictionaryKey:@"NSMicrophoneUsageDescription"] || ![bundle objectForInfoDictionaryKey:@"NSSpeechRecognitionUsageDescription"]) {
        [self fail:@"当前桌面构建缺少语音权限声明，请重新构建或安装最新版 Spielberg"];
        return;
    }
    self.recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:locale.length ? locale : @"zh-CN"]];
    if (!self.recognizer) { [self fail:@"系统不支持此语言的语音识别，请使用文字输入"]; return; }
    __weak SpielbergSpeech *weakSelf = self;
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        dispatch_async(dispatch_get_main_queue(), ^{
            SpielbergSpeech *owner = weakSelf;
            if (!owner || ![owner.session isEqualToString:session]) return;
            if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) { [owner fail:@"请在系统设置 → 隐私与安全性 → 语音识别中允许 Spielberg"]; return; }
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    SpielbergSpeech *current = weakSelf;
                    if (!current || ![current.session isEqualToString:session]) return;
                    if (!granted) { [current fail:@"请在系统设置 → 隐私与安全性 → 麦克风中允许 Spielberg"]; return; }
                    [current beginAudio:session];
                });
            }];
        });
    }];
}
@end

static SpielbergSpeech *recognizer API_AVAILABLE(macos(10.15));
static void onMain(dispatch_block_t action) {
    if (NSThread.isMainThread) action(); else dispatch_async(dispatch_get_main_queue(), action);
}
bool spielberg_speech_available(void) { if (@available(macOS 10.15, *)) return true; return false; }
void spielberg_speech_start(const char *session, const char *locale, SpielbergSpeechCallback callback) {
    NSString *sessionID = [NSString stringWithUTF8String:session];
    NSString *language = [NSString stringWithUTF8String:locale];
    onMain(^{
        if (@available(macOS 10.15, *)) {
            if (!recognizer) recognizer = [[SpielbergSpeech alloc] init];
            [recognizer start:sessionID locale:language callback:callback];
        }
    });
}
void spielberg_speech_stop(const char *session, bool cancel) {
    NSString *sessionID = [NSString stringWithUTF8String:session];
    onMain(^{ if (@available(macOS 10.15, *)) { if ([recognizer.session isEqualToString:sessionID]) [recognizer stop:cancel]; } });
}
void spielberg_speech_shutdown(void) {
    onMain(^{ if (@available(macOS 10.15, *)) [recognizer stop:YES]; });
}
