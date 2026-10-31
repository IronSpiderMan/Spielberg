"""Screenplay-grounded planning and verified MiniMax H3 Ref2VA compilation.

Official format: https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing
No video may be submitted without a matching audited compilation record.
"""
from collections import Counter
import hashlib
import json
import re
import time

VERSION = 'screenplay-h3-ref2va-v2'
FIELDS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description',
          'overall_soundscape', 'non_diegetic_music']


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def source_lines(text, names):
    lines = []
    scene_context = ''
    speakers = sorted(set(names) | {'妹妹', '母亲', '父亲'}, key=len, reverse=True)
    for raw in text.splitlines():
        raw = raw.strip()
        if raw.startswith('##'):
            scene_context = raw.lstrip('#').strip()
            continue
        if not raw or raw.startswith(('#', '分集梗概：', '梗概：')):
            continue
        item = {'id': len(lines) + 1, 'text': raw, 'scene_context': scene_context}
        if '：' in raw:
            prefix, spoken = raw.split('：', 1)
            speaker = next((name for name in speakers if prefix.startswith(name)), None)
            visible_writing = re.search('写|标注|记下|屏幕|白板', prefix) and not re.search('说|问|答|念|喊', prefix)
            if speaker and spoken.strip() and not visible_writing:
                item['dialogue'] = {'speaker': {'母亲': '林慧宁', '父亲': '未明远'}.get(speaker, speaker),
                                    'text': spoken.strip()}
        lines.append(item)
    return lines


def parse_json(raw):
    return json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip()))


def text_action(api, name, payload, **kwargs):
    # Only text compilation may be retried. Never retry a video submission here.
    for attempt in range(4):
        try:
            return api.action(name, payload, **kwargs)
        except RuntimeError as error:
            transient = any(term in str(error) for term in ('502 Bad Gateway', '503 Service Unavailable',
                            '504 Gateway Timeout', 'Upstream service temporarily unavailable'))
            if not transient or attempt == 3:
                raise
            api.log(f'Prompt服务暂时不可用，5秒后重试文本编译（{attempt + 1}/3）。')
            time.sleep(5)


def normalize_labels(prompt):
    """Repair only unambiguous reference typography, never dialogue or content."""
    parts = re.split(r'(<d>.*?</d>|"[^"\n]*")', prompt, flags=re.S)
    for index in range(0, len(parts), 2):
        part = re.sub(r'<(Subject|Picture|Video|Audio)\s*(\d+)>', r'<\1 \2>', parts[index])
        parts[index] = re.sub(r'(?<![<\w])(Subject|Picture|Video|Audio) (\d+)\b(?!>)', r'<\1 \2>', part)
    prompt = ''.join(parts)
    matches = list(re.finditer(r'(?m)^(' + '|'.join(FIELDS) + r'):', prompt))
    if [m.group(1) for m in matches] != FIELDS:
        return prompt
    sections = {m.group(1): prompt[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(prompt)].strip()
                for i, m in enumerate(matches)}
    sections['subject_definitions'] = re.sub(r'(?m)^(<Subject \d+>):\s*', r'\1 is ', sections['subject_definitions'])
    # A named character keeps the same reference label in every shot, even when
    # the text model switches back to the name after its first appearance.
    for number, name in re.findall(r'(?m)^<Subject (\d+)> is ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,2}),', sections['subject_definitions']):
        for field in ('summary', 'detailed_description'):
            segments = re.split(r'(<d>.*?</d>|"[^"\n]*")', sections[field], flags=re.S)
            for index in range(0, len(segments), 2):
                segments[index] = re.sub(r'\b' + re.escape(name) + r'\b', f'<Subject {number}>', segments[index])
            sections[field] = ''.join(segments)
    detail = sections['detailed_description']
    for subject in re.findall(r'(?m)^<Subject (\d+)>', sections['subject_definitions']):
        appearances = [number for number, body in re.findall(r'\[Shot (\d+)\](.*?)(?=\[Shot \d+\]|\Z)', detail, re.S)
                       if f'<Subject {subject}>' in body]
        if appearances:
            label = f'<Subject {subject}>'
            replacement = label + ' (appears in ' + ', '.join(f'[Shot {n}]' for n in appearances) + '):'
            sections['retention_analysis'] = re.sub(re.escape(label) + r'(?:\s*/\s*|\s+from\s+)<Picture \d+>:',
                replacement, sections['retention_analysis'])
            sections['retention_analysis'] = re.sub(re.escape(label) + r' \(appears in [^)]+\):',
                replacement, sections['retention_analysis'])
    return '\n\n'.join(field + ':\n' + sections[field] for field in FIELDS)


def semantic_audit(api, prompt, spec):
    instruction = '''你是严格的剧本连续性审读员，只返回JSON {"ok":true或false,"issues":[具体错误]}。核对candidate_prompt是否忠实完成assigned_shots：只允许当前shots分配的动作，source_lines只是原文出处和上下文，不能据此重演上一段或提前演下一段。previous_scene_end、next_scene_start用于限定开场/结束；例如已经惊醒后下一段不能再醒一次，手部查看段不能提前走向镜子。动作、对白顺序、说话者、切镜时点、角色及服装连续性必须一致；镜头静态细节可合理展开，不能添加剧情、内心词或额外对白。原剧本道白逐字保留，source_lines无对白则无语言人声。不要把“旧课表”等道具名称擅自变成必须印在画面的标题；仅原文明确规定可见文字时呈现相应内容。参考图用于身份/环境，不强制复制人物姿态；输入的continuity_constraints必须遵守。只指出实际内容错漏，允许与附图一致的自然光、材质、呼吸、衣物摩擦等非剧情细节，不因没有逐字复述源文而误报。不要要求增加剧情或对话。'''
    result = text_action(api, 'prompts/optimize', {'kind': 'structured', 'instruction': instruction,
        'prompt': json.dumps({'assigned_shots': spec, 'candidate_prompt': prompt}, ensure_ascii=False)}, timeout=None)
    audit = parse_json(result['prompt'])
    if audit.get('ok') is not True:
        raise ValueError('剧本连续性审读未通过：' + json.dumps(audit.get('issues', []), ensure_ascii=False))
    return audit


def validate_plan(plan, lines, refs, slots):
    scenes = plan.get('scenes', [])
    if not scenes or (slots and len(scenes) != len(slots)):
        raise ValueError('分镜场景数量与已有场景槽不一致')
    covered, spoken, spoken_order = set(), Counter(), []
    by_id = {line['id']: line for line in lines}
    for index, scene in enumerate(scenes):
        ids = scene.get('source_line_ids', [])
        if not ids or any(type(i) is not int or i not in by_id for i in ids) or len(ids) != len(set(ids)):
            raise ValueError(f'场景{index + 1}缺少有效剧本行号')
        if ids != sorted(ids):
            raise ValueError('场景内原剧本行号必须按原文顺序')
        covered.update(ids)
        spoken.update(i for i in ids if by_id[i].get('dialogue'))
        spoken_order.extend(i for i in ids if by_id[i].get('dialogue'))
        selected = scene.get('reference_media_ids', [])
        if not 1 <= len(selected) <= 9 or len(set(selected)) != len(selected) or not set(selected) <= refs:
            raise ValueError(f'场景{index + 1}引用无效')
        duration = scene.get('duration')
        if type(duration) is not int or not 4 <= duration <= 15:
            raise ValueError('场景时长必须为4–15秒整数')
        if slots and (scene.get('scene_id') != slots[index]['id'] or duration != slots[index]['duration']):
            raise ValueError('已有场景ID、顺序和时长必须保留')
        shots = scene.get('shots', [])
        if not shots or any(not s.get('description') or not isinstance(s.get('duration'), (int, float))
                            or s['duration'] <= 0 for s in shots):
            raise ValueError('缺少明确的镜头与时长')
        if abs(sum(s['duration'] for s in shots) - duration) > .01:
            raise ValueError('镜头时长之和与场景时长不一致')
    if covered != set(by_id):
        raise ValueError(f'剧本行有遗漏：{sorted(set(by_id) - covered)}')
    if spoken != Counter({line['id']: 1 for line in lines if line.get('dialogue')}):
        raise ValueError('原剧本对白必须按完整台词逐句分配且只出现一次')
    if spoken_order != [line['id'] for line in lines if line.get('dialogue')]:
        raise ValueError('不能调整原剧本对白的发生顺序')


def validate_prompt(prompt, spec, image_ids):
    matches = list(re.finditer(r'(?m)^(' + '|'.join(FIELDS) + r'):', prompt))
    if [m.group(1) for m in matches] != FIELDS or not prompt.startswith('subject_definitions:'):
        raise ValueError('H3 Ref2VA必须完整使用六段且顺序正确')
    sections = {m.group(1): prompt[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(prompt)].strip()
                for i, m in enumerate(matches)}
    if any(not sections[field] for field in FIELDS) or '```' in prompt or '@角色' in prompt or re.search(r'\{[^{}]+\}', prompt):
        raise ValueError('Prompt含空字段、代码围栏或未解析资源引用')
    if not sections['summary'].startswith('[reference generation]'):
        raise ValueError('当前纯图片全能参考任务类型必须为reference generation')
    pictures = {int(x) for x in re.findall(r'<Picture (\d+)>', prompt)}
    invented = re.findall(r'<(?:Video|Audio) \d+>', prompt)
    if pictures != set(range(1, len(image_ids) + 1)) or invented:
        raise ValueError(f'引用错误：实际Picture编号={sorted(pictures)}，必须为1到{len(image_ids)}；不允许音视频标签={invented}')
    definitions = set(re.findall(r'(?m)^<Subject (\d+)>', sections['subject_definitions']))
    used = set(re.findall(r'<Subject (\d+)>', prompt))
    if not definitions or used != definitions:
        raise ValueError('Subject标签缺失定义或编号不一致')
    if re.search(r'\(S\d+\)', sections['retention_analysis']):
        raise ValueError('retention_analysis不得分配说话者编号')
    detail = sections['detailed_description']
    shots = list(re.finditer(r'\[Shot (\d+)\]', detail))
    if [int(m.group(1)) for m in shots] != list(range(1, len(spec['shots']) + 1)):
        raise ValueError('镜头数量或顺序不符合分镜')
    if re.match(r'\s*At \d', detail[shots[0].end():]):
        raise ValueError('Shot 1不得带切镜时间戳')
    elapsed = 0.
    for index, shot in enumerate(spec['shots'][:-1], 1):
        elapsed += shot['duration']
        at = re.match(r'\s+At (\d\d):(\d\d)\.(\d{3}),', detail[shots[index].end():])
        if not at or abs(int(at[1]) * 60 + int(at[2]) + int(at[3]) / 1000 - elapsed) > .001:
            raise ValueError('切镜时间必须与分镜时长累加值相同')
    if len(shots) > 1 and re.search(r'without cuts|one (?:continuous|uninterrupted) shot', detail, re.I):
        raise ValueError('多镜头Prompt不得声明全程不切镜')
    actual = re.findall(r'<d>\[Chinese\]\s*(.*?)</d>', detail, re.S)
    expected = [line['dialogue']['text'] for line in spec['source_lines'] if line.get('dialogue')]
    if actual != expected:
        raise ValueError(f'对白与原剧本不一致：期望{expected!r}，实际{actual!r}')
    if len(re.findall(r'<d>', prompt)) != len(actual):
        raise ValueError('含未授权的非中文台词或重复对白')
    if actual and not re.search(r'\(S1\)', detail):
        raise ValueError('对白缺少稳定说话者编号')
    english = re.sub(r'<d>.*?</d>|"[^"\n]*"', '', prompt, flags=re.S)
    if re.search(r'[\u3400-\u9fff]', english):
        raise ValueError('除对白和画面可见文字外，六段正文必须为英文')
    if len(re.findall(r'\b[A-Za-z]+\b', detail)) < 260:
        raise ValueError('逐镜描述过于简略，需按官方指南展开构图、动作、人物、光线和声音')
    return {'format': 'ref2va', 'sections': FIELDS, 'shots': len(shots), 'dialogue_lines': len(expected),
            'picture_count': len(image_ids), 'validated_at': time.time()}


def require_compiled(api, scene, image_ids):
    path = api.OUT / 'prompts' / f'scene-{scene["id"]:04}.json'
    if not path.exists():
        raise ValueError('场景尚未按原剧本编译为H3 Prompt，禁止直接提交旧描述')
    proof = json.loads(path.read_text())
    if proof.get('version') != VERSION or proof['prompt'] != scene['prompt'] or proof['image_ids'] != image_ids:
        raise ValueError('Prompt或参考素材已变化，必须重新编译与校验')
    if proof.get('semantic_audit', {}).get('ok') is not True:
        raise ValueError('Prompt尚未通过剧本连续性审读，禁止提交')
    scripts = api.rows("SELECT content FROM screenplays WHERE episode_id=? AND format='markdown'", (scene['episode_id'],))
    if not scripts or digest(scripts[0]['content']) != proof['source_sha256']:
        raise ValueError('原剧本已变化，必须重新编译Prompt，禁止提交过期版本')
    validate_prompt(scene['prompt'], proof['spec'], image_ids)


def prepare_episode(api, episode):
    eid = episode['id']
    script = api.rows("SELECT content FROM screenplays WHERE episode_id=? AND format='markdown'", (eid,))[0]['content']
    source_hash = digest(script)
    existing = api.rows('SELECT * FROM scenes WHERE episode_id=? ORDER BY sort_order,id', (eid,))
    roles = api.rows('SELECT name,description,design_media_id FROM roles ORDER BY id')
    lines = source_lines(script, [r['name'] for r in roles])
    college = episode['sort_order'] >= 10
    variants = {'未来': 43, '蓝秋月': 50, '王猛': 29, '未约翰': 30} if college else {}
    resources = [{'media_id': variants.get(r['name'], r['design_media_id']), 'name': r['name'],
                  'role': r['description'][:240]} for r in roles if r['design_media_id']]
    location_names = {55: '家中餐厅、厨房及妹妹的固定外貌（右侧马尾少女）；父母身份仍以正式定妆为准',
                      56: '家中卧室：左窗、旧书桌、床、右侧门及成年后电脑；只约束房间与物件，不固定人物姿态',
                      57: '家门、餐厅空间连接及妹妹的固定外貌（前景马尾少女）；不能复制挥手动作到别的剧情',
                      58: '中学校门；仅剧本明确到达校门时使用',
                      59: '学生宿舍：木柜、金属上下铺、通往走廊的门；只约束空间',
                      60: '高中教室及课桌黑板布局；只约束空间，不复制照片人物动作'}
    environment_ids = set(location_names) if not college else set()
    for mid in sorted(environment_ids):
            resources += [{'media_id': row['id'], 'name': row['name'], 'role': location_names[mid]}
                      for row in api.rows('SELECT id,name FROM media WHERE id=? AND deleted_at IS NULL', (mid,))]
    valid_refs = {r['media_id'] for r in resources}
    backup = api.OUT / 'backups' / f'episode-{eid:02}.json'
    if not backup.exists():
        api.save(backup, {'episode': episode, 'screenplay': script, 'scenes': existing,
                         'options': api.rows('SELECT scene_id,value FROM scene_options WHERE scene_id IN (SELECT id FROM scenes WHERE episode_id=?)', (eid,))})
    planfile = api.OUT / f'episode-{eid:02}-h3-plan.json'
    if planfile.exists():
        plan = json.loads(planfile.read_text())
        if plan['source_sha256'] != source_hash:
            raise ValueError('剧本已变化，需重新生成当前集分镜计划')
    else:
        slots = []
        for scene in existing:
            options = api.rows('SELECT value FROM scene_options WHERE scene_id=?', (scene['id'],))
            options = json.loads(options[0]['value']) if options else {}
            slots.append({'id': scene['id'], 'title': scene['title'], 'duration': options.get('duration', 15),
                          'previous_image_ids': options.get('reference_media_ids', [])})
        instruction = '''只依据输入的逐行原剧本重新做分镜，绝不依据旧视频描述或添加台词/内心旁白。完整覆盖所有原剧本行，所有dialogue原台词各分配到一个且仅一个场景；同一句不得拆段、不得复制到多个场景。source_line_ids用于追溯，动作行可跨段重复。每段4至15秒，已有scene_slots时必须保持场景ID、顺序、数量、标题与时长，按标题匹配其原剧本动作。每场景1至3个有明确切镜理由的镜头，shots.duration总和等于duration，不能堆积超过15秒可演出的动作对白。参考图仅可选择resources真实ID，最多9张；必须用当前正式定妆，环境图只约束环境布局，不强制照搬人物姿态或第一帧。不得添加配乐、字幕、科幻光效、旁白或剧情。完整中文剧本优先于旧场景标题；第1场只有手在鼠标上、猛醒及打量房间，不能加入“我不是还在”等剧本未写的台词。返回JSON：{"scenes":[{"scene_id":已有ID或null,"title":"标题","duration":15,"source_line_ids":[原文行号],"reference_media_ids":[ID],"shots":[{"duration":6,"description":"清晰可见动作与状态","camera":"景别与运镜","sound":"环境和物理声音，不填改写台词"}]}]}。不要省略任何原剧本对白，不用旧Prompt做改写。'''
        feedback = ''
        for attempt in range(3):
            result = text_action(api, 'prompts/optimize', {'kind': 'structured', 'instruction': instruction + feedback,
                'prompt': json.dumps({'episode': episode['title'], 'source_lines': lines, 'scene_slots': slots,
                                      'resources': resources}, ensure_ascii=False)}, timeout=None)
            try:
                plan = parse_json(result['prompt'])
                validate_plan(plan, lines, valid_refs, slots)
                break
            except (ValueError, KeyError, TypeError) as error:
                feedback = '\n上次未通过校验，请重新给出完整正确计划：' + str(error)
        else:
            raise ValueError('剧本分镜计划校验连续失败：' + feedback)
        plan.update(version=VERSION, source_sha256=source_hash)
        api.save(planfile, plan)
    by_id = {line['id']: line for line in lines}
    validate_plan(plan, lines, valid_refs, [])
    for index, spec in enumerate(plan['scenes']):
        if not spec.get('scene_id'):
            created = api.request(f'{api.BACKEND}/api/v1/projects/{api.PID}/episodes/{eid}/scenes',
                                  {'title': spec['title'], 'description': '', 'prompt': ''})['data']
            spec['scene_id'] = created['id']
            api.save(planfile, plan)
        sid = spec['scene_id']
        spec['source_lines'] = [by_id[i] for i in spec['source_line_ids']]
        spec['previous_scene_end'] = plan['scenes'][index - 1]['shots'][-1] if index else None
        spec['next_scene_start'] = plan['scenes'][index + 1]['shots'][0] if index + 1 < len(plan['scenes']) else None
        if not college:
            title = spec['title']
            location = (56 if '卧室' in title else 55 if any(x in title for x in ('餐厅', '餐桌'))
                        else 57 if '家门' in title or (eid == 1 and sid in (6, 16, 17, 18))
                        else 59 if '宿舍' in title or (eid == 1 and sid == 20)
                        else 60 if '教室' in title or '课间' in title else None)
            selected = spec['reference_media_ids']
            if location and location not in selected:
                selected.insert(0, location)
            if any('妹妹' in line['text'] for line in spec['source_lines']) and not ({55, 57} & set(selected)):
                selected.append(55)
            if eid == 1 and sid == 5:
                spec['reference_media_ids'] = [56, 42]  # Mother/sister only speak through the closed door.
            if eid == 1 and sid == 18:
                spec['reference_media_ids'] = [57, 42]  # Follow the departing boy; the family remains off-screen.
            if len(selected) > 9:
                raise ValueError('场景连续性参考超过9张，需重新分镜')
        if eid == 1:
            spec['continuity_constraints'] = {
                'wardrobe': 'For home scenes 1–16, Weilai wears a light grey T-shirt and dark track trousers; the school jacket is on the chair, not duplicated on his body. At the departure scene 17 and school scenes thereafter, use the navy-and-white school jacket seen in the departure/school references. Do not add a dressing scene.',
                'sister': 'The younger sister keeps the dark ponytail and plain cream T-shirt of the girl in family references 55/57. She is a separate character, not Lan Qiuyue, and must not reuse another named female face.',
                'voices': 'Use stable youthful, clear Mandarin for Weilai; a warm adult female Mandarin voice for Lin Huining, a calm lower adult male voice for Wei Mingyuan, and a lighter youthful female voice for the sister. No voice references were supplied; do not invent Audio tags.',
                'room': 'Only preserve background layout and the relevant explicitly defined characters from scene pictures; ignore other people or fixed poses. Do not force character-sheet framing or keyframe alignment.'}
        ids = spec['reference_media_ids']
        proof_file = api.OUT / 'prompts' / f'scene-{sid:04}.json'
        prompt = None
        feedback = ''
        if proof_file.exists():
            proof = json.loads(proof_file.read_text())
            if proof['source_sha256'] != source_hash:
                raise ValueError('已编译Prompt的源剧本已变化')
            if proof['image_ids'] != ids:
                raise ValueError('已编译Prompt的参考图顺序已变化，需重新编译')
            try:
                prompt = normalize_labels(proof['prompt'])
                proof['prompt'] = prompt
                validate_prompt(prompt, spec, ids)
                spec_hash = digest(json.dumps(spec, ensure_ascii=False, sort_keys=True))
                if 'semantic_audit' not in proof or proof.get('spec_sha256') != spec_hash:
                    proof['semantic_audit'] = semantic_audit(api, prompt, spec)
                    proof['spec'] = spec
                    proof['spec_sha256'] = spec_hash
                    api.save(proof_file, proof)
                api.save(proof_file, proof)
                proof_file.with_suffix('.txt').write_text(prompt)
            except ValueError as error:
                feedback = '\n上一版未通过剧本审读，必须修正如下问题后重新输出完整Prompt：' + str(error)
                api.save(api.OUT / 'rejected' / f'scene-{sid:04}-{int(time.time())}.json',
                         {**proof, 'rejection': str(error)})
                proof_file.unlink()
                prompt = None
        if prompt is None:
            api.log(f'H3 Prompt编译：{episode["title"]} / {spec["title"]}')
            for attempt in range(3):
                result = text_action(api, 'prompts/optimize', {'kind': 'video', 'prompt_format': 'minimax-h3',
                    'h3_mode': 'ref2va', 'duration': spec['duration'], 'image_media_ids': ids,
                    'prompt': json.dumps({'screenplay_scene': spec, 'source_is_authoritative': True}, ensure_ascii=False),
                    'instruction': '''严格只描写shots中当前分配的动作；source_lines为原文出处，不可重演上段、不可提前演下段。开场承接previous_scene_end，结尾不能越过next_scene_start。例如第2场只有墙上旧物与查看年轻双手，不可再次惊醒，也不可走到镜子；走到镜子属于第3场。所有标签必须写成<Subject 1>、<Picture 1>的带尖括号格式。依据source_lines及附图写H3 Ref2VA六段，正文英文，仅原文对白和画面可见文字保留中文。source_lines是唯一剧情与对白来源，绝不新增内心台词或旁白；source_lines无对白则整个Prompt无<d>。按source_lines顺序，每句原台词完整保留在一个<d>[Chinese] 原文</d>中且仅出现一次，句内不跨切镜；不能翻译、缩写、改标点或添加说话词。保留shots数量及duration，后续切镜时间按duration累加。summary必须以[reference generation]起头，无任何视频音频参考。人物身份来自正式定妆，环境图只复用场景布局，不作为首帧，不复制图中人物的固定姿态，也不要生成重复人物。全篇稳定Subject和Picture对应关系，人物在第一次出现时描述可见外观；用罗马字人物名，不能在英文段落写中文角色名。发声按实际先后编号S1,S2，retention_analysis不得写S编号。detailed_description以1至2句建立风格，然后逐镜详细写构图、机位、光线、可见动作、运镜方向速度幅度、人物反应、同步声音及结束状态，正常约350至500英文词。避免空泛“电影感”总结句。真实青春家庭剧，保留服装、物件、空间轴线及人物连续性，16:9、768p。不添字幕，不添配乐，non_diegetic_music为N/A。''' + feedback}, timeout=None)
                raw_prompt = result['prompt']
                prompt = normalize_labels(raw_prompt)
                attempt_file = api.OUT / 'attempts' / f'scene-{sid:04}-{attempt + 1}.json'
                api.save(attempt_file, {'raw_prompt': raw_prompt, 'prompt': prompt, 'image_ids': ids, 'spec': spec})
                try:
                    audit = validate_prompt(prompt, spec, ids)
                    content_audit = semantic_audit(api, prompt, spec)
                    break
                except ValueError as error:
                    feedback = '\n上次校验失败，请输出完整修正Prompt：' + str(error)
            else:
                raise ValueError(f'场景{sid} H3规范校验连续失败：{feedback}')
            proof = {'version': VERSION, 'source_sha256': source_hash, 'scene_id': sid,
                     'image_ids': ids, 'spec': spec, 'spec_sha256': digest(json.dumps(spec, ensure_ascii=False, sort_keys=True)),
                     'prompt': prompt, 'audit': audit, 'semantic_audit': content_audit}
            api.save(proof_file, proof)
            proof_file.with_suffix('.txt').write_text(prompt)
        options = {'video_mode': 'i2v', 'duration': spec['duration'], 'aspect_ratio': '16:9',
                   'size': '1344x768', 'resolution': '768p', 'reference_media_ids': ids,
                   'prompt_format': VERSION}
        api.request(f'{api.BACKEND}/api/v1/projects/{api.PID}/scenes/{sid}',
                    {'prompt': prompt, 'reference_media_id': ids[0], 'generation_options': options}, method='PATCH')
    api.request(f'{api.BACKEND}/api/v1/projects/{api.PID}/episodes/{eid}',
                {'storyboard': {'aspect_ratio': '16:9', 'scenes': plan['scenes'],
                                'duration': sum(s['duration'] for s in plan['scenes'])}}, method='PATCH')
    api.save(api.OUT / f'episode-{eid:02}-prompts-ready.json', {'version': VERSION,
             'source_sha256': source_hash, 'scenes': len(plan['scenes']), 'validated_at': time.time()})
    return api.rows('SELECT * FROM scenes WHERE episode_id=? ORDER BY sort_order,id', (eid,))
