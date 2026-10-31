import copy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
import h3_prompt_workflow as h3


def fixture():
    spec = {'duration': 15, 'shots': [{'duration': 6}, {'duration': 9}],
            'source_lines': [{'id': 1, 'text': '甲：先停一下。',
                              'dialogue': {'speaker': '甲', 'text': '先停一下。'}}]}
    prompt = '''subject_definitions:
<Subject 1> is the young man in <Picture 1>, with short black hair and a grey cotton shirt.
<Subject 2> is the small study in <Picture 2>, with a wooden desk by the left window and a doorway to the right.

summary:
[reference generation] A fifteen-second two-shot scene follows <Subject 1> waking at the desk in <Subject 2> and asking for a pause.

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - retain his face, hair, proportions and clothing.
<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - retain the study layout, window position and desk materials.

detailed_description:
The scene uses natural afternoon window light and realistic indoor photography, with ordinary cotton fabric and worn wooden surfaces.
[Shot 1] An opening close view establishes the right hand of <Subject 1> resting on the desk in <Subject 2>. His fingers lie beside an open exercise book, and the near edge of a keyboard remains visible at the bottom of the frame. He has been leaning forward with his head lowered. His shoulders suddenly tighten, his fingers curl briefly against the tabletop, and his head starts to rise. The camera tilts upward with small amplitude at slow speed, keeping his hand and torso in the same continuous movement before revealing his face. His short black hair is slightly untidy, and his grey shirt remains loose around his shoulders. Daylight comes from the left throughout the motion; shadows do not change direction. He takes a short breath and remains seated, looking toward the room rather than at the lens. His lips stay closed. The chair makes a brief scrape as he shifts his weight, then settles again. End on his alert, uncertain expression without adding speech or a new physical action.
[Shot 2] At 00:06.000, the camera cuts to an over-the-shoulder medium view of <Subject 1> in <Subject 2>, preserving the window-to-door axis and his seated position. The camera tracks sideways with small amplitude at slow speed as his gaze moves toward the open doorway. His hand remains beside the same book, and the keyboard stays at the original desk edge. He straightens gradually, holds his shoulders still, and pauses before speaking. <Subject 1> (S1) says in a clear youthful Mandarin voice at an ordinary conversational pace, <d>[Chinese] 先停一下。</d> His lips close after the line. The camera stops moving and holds the final composition, with the man in the near foreground and the doorway behind him. He does not stand, leave the room, touch his face, or begin another line before the final frame. Window light remains steady across the book, desk and side of his face. Natural breathing and the last small rustle of his sleeve remain audible beneath the quiet room.

overall_soundscape:
Quiet indoor room tone continues beneath one brief chair scrape, fabric movement and natural breathing.

non_diegetic_music:
N/A'''
    return prompt, spec


def test_valid_ref2va_and_exact_dialogue():
    prompt, spec = fixture()
    assert h3.validate_prompt(prompt, spec, [1, 2])['dialogue_lines'] == 1
    with pytest.raises(ValueError, match='对白与原剧本不一致'):
        h3.validate_prompt(prompt.replace('先停一下。', '我不是还在……'), spec, [1, 2])


def test_rejects_wrong_reference_labels_and_cut_time():
    prompt, spec = fixture()
    with pytest.raises(ValueError, match='引用错误'):
        h3.validate_prompt(prompt + '\n<Audio 1> supplies a voice.', spec, [1, 2])
    with pytest.raises(ValueError, match='引用错误'):
        h3.validate_prompt(prompt.replace('<Picture 2>', '<Picture 3>'), spec, [1, 2])
    with pytest.raises(ValueError, match='切镜时间'):
        h3.validate_prompt(prompt.replace('00:06.000', '00:07.000'), spec, [1, 2])
    with pytest.raises(ValueError, match='正文必须为英文'):
        h3.validate_prompt(prompt.replace('The scene uses', '写实摄影 The scene uses'), spec, [1, 2])


def test_reference_typography_repair_preserves_dialogue():
    prompt, spec = fixture()
    bare = prompt.replace('<Subject 1>', 'Subject 1').replace('<Subject 2>', 'Subject 2')
    bare = bare.replace('<Picture 1>', 'Picture 1').replace('<Picture 2>', 'Picture 2')
    repaired = h3.normalize_labels(bare)
    assert '<Picture 1>' in repaired and '<Subject 2>' in repaired
    assert '<d>[Chinese] 先停一下。</d>' in repaired
    h3.validate_prompt(repaired, spec, [1, 2])


def test_source_parser_does_not_turn_visible_writing_into_dialogue():
    lines = h3.source_lines('# 标题\n梗概：简述\n甲抬起手：先停一下。\n甲在纸上写：第一项。', ['甲'])
    assert len(lines) == 2
    assert lines[0]['dialogue']['text'] == '先停一下。'
    assert 'dialogue' not in lines[1]


def test_plan_cannot_omit_or_repeat_script_dialogue():
    lines = h3.source_lines('甲起身。\n甲：先停一下。', ['甲'])
    scene = {'duration': 15, 'source_line_ids': [1, 2], 'reference_media_ids': [1],
             'shots': [{'duration': 15, 'description': '甲起身并说原文对白'}]}
    h3.validate_plan({'scenes': [scene]}, lines, {1}, [])
    with pytest.raises(ValueError, match='只出现一次'):
        h3.validate_plan({'scenes': [scene, copy.deepcopy(scene)]}, lines, {1}, [])
    omitted = copy.deepcopy(scene)
    omitted['source_line_ids'] = [1]
    with pytest.raises(ValueError, match='剧本行有遗漏'):
        h3.validate_plan({'scenes': [omitted]}, lines, {1}, [])
