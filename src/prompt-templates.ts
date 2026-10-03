export type PromptTemplate = { id: string; name: string; content: string };

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  { id: "minimax-h3-t2va", name: "minimax-h3-t2va", content: `integrated_multimodal_description: [Shot 1] {VISUAL_STYLE_AND_COLOR_PALETTE}. {OPENING_COMPOSITION_SHOT_SIZE_AND_CAMERA_ANGLE}. {SUBJECT_APPEARANCE_CLOTHING_AND_INITIAL_POSITION}. {ENVIRONMENT_LIGHTING_AND_KEY_OBJECTS}. {INITIAL_ACTION}. {CONTINUOUS_ACTION_AND_VISIBLE_REACTIONS}. {CAMERA_MOVEMENT_DIRECTION_RANGE_AND_SPEED}. {FINAL_ACTION_AND_ENDING_COMPOSITION}. {OPTIONAL_DIALOGUE_AND_SYNCHRONIZED_DIEGETIC_SOUND}. All action unfolds in one continuous shot without cuts.

overall_soundscape: {AMBIENT_SOUNDS_PHYSICAL_ACTION_SOUNDS_AND_NONVERBAL_VOCAL_SOUNDS}

non_diegetic_music: N/A` },
  { id: "minimax-h3-i2VA", name: "minimax-h3-i2VA", content: `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] {VISUAL_STYLE_CONSISTENT_WITH_THE_FIRST_FRAME}. The opening matches <Picture 1>, including {SUBJECT_APPEARANCE_INITIAL_POSE_COMPOSITION_AND_SCENE_LAYOUT}. {LIGHTING_AND_VISIBLE_ENVIRONMENTAL_DETAILS}. Starting from this exact visible state, {ACTION_ONSET}. {SUBSEQUENT_ACTION_AND_VISIBLE_REACTIONS}. {CAMERA_MOVEMENT_DIRECTION_RANGE_AND_SPEED}. The shot ends with {FINAL_ACTION_POSE_AND_COMPOSITION}. {OPTIONAL_DIALOGUE_AND_SYNCHRONIZED_DIEGETIC_SOUND}. Keep {IDENTITY_CLOTHING_KEY_OBJECTS_AND_OTHER_UNCHANGING_FEATURES} consistent throughout. All action unfolds in one continuous shot without cuts.

overall_soundscape: {AMBIENT_SOUNDS_PHYSICAL_ACTION_SOUNDS_AND_NONVERBAL_VOCAL_SOUNDS}

non_diegetic_music: N/A` },
  { id: "minimax-h3-l2va", name: "minimax-h3-l2va", content: `How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the {DURATION}-second mark of the target video.

integrated_multimodal_description: [Shot 1] {VISUAL_STYLE_CONSISTENT_WITH_THE_LAST_FRAME}. The video begins with {PLAUSIBLE_EARLIER_STATE}, showing {SUBJECT_APPEARANCE_INITIAL_POSE_AND_OPENING_COMPOSITION} in {ENVIRONMENT_AND_LIGHTING}. {ACTION_THAT_LEADS_TOWARD_THE_REFERENCE_ENDING}. {INTERMEDIATE_CHANGES_IN_MOVEMENT_POSE_OBJECT_STATE_AND_COMPOSITION}. {CAMERA_MOVEMENT_DIRECTION_RANGE_AND_SPEED}. During the final moments, {FINAL_ADJUSTMENTS_THAT_COMPLETE_THE_TRANSITION}. At the end of the video, the subject positions, poses, object arrangement, framing, and lighting match <Picture 1>. {OPTIONAL_DIALOGUE_AND_SYNCHRONIZED_DIEGETIC_SOUND}. Keep {IDENTITY_CLOTHING_AND_OTHER_UNCHANGING_FEATURES} consistent throughout. The sequence plays forward in one continuous shot without cuts.

overall_soundscape: {AMBIENT_SOUNDS_PHYSICAL_ACTION_SOUNDS_AND_NONVERBAL_VOCAL_SOUNDS}

non_diegetic_music: N/A` },
  { id: "minimax-h3-fl2va", name: "minimax-h3-fl2va", content: `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the {DURATION}-second mark of the target video.

integrated_multimodal_description: [Shot 1] {VISUAL_STYLE_CONSISTENT_WITH_THE_REFERENCE_FRAMES}. The video opens in the state established by Picture 1, with {STARTING_POSE_SUBJECT_POSITIONS_OBJECT_STATES_AND_COMPOSITION}. {INITIAL_MOVEMENT_TOWARD_THE_ENDING_STATE}. {OBSERVABLE_INTERMEDIATE_ACTIONS_AND_POSE_CHANGES}. {CONTINUOUS_CAMERA_MOVEMENT_AND_COMPOSITION_CHANGES}. {REQUIRED_ENVIRONMENTAL_OR_LIGHTING_TRANSITION}. As the shot approaches its end, {FINAL_MOVEMENTS_THAT_CLOSE_THE_REMAINING_DIFFERENCES}. The video finishes in the state established by Picture 2, matching its final poses, subject placement, object arrangement, framing, and lighting. {OPTIONAL_DIALOGUE_AND_SYNCHRONIZED_DIEGETIC_SOUND}. Keep {IDENTITY_CLOTHING_AND_OTHER_UNCHANGING_FEATURES} consistent between the two endpoints. The transition occurs through continuous visible motion in one uninterrupted shot without cuts.

overall_soundscape: {AMBIENT_SOUNDS_PHYSICAL_ACTION_SOUNDS_AND_NONVERBAL_VOCAL_SOUNDS}

non_diegetic_music: N/A` },
  { id: "minimax-h3-ref2va", name: "minimax-h3-ref2va", content: `subject_definitions:
<Subject 1> is {MAIN_SUBJECT} from <Picture 1>, identified by {FACIAL_FEATURES_HAIRSTYLE_BODY_PROPORTIONS_CLOTHING_AND_OTHER_IDENTITY_DETAILS}.
<Subject 2> is {ENVIRONMENT} from <Picture 2>, defined by {LAYOUT_ARCHITECTURE_MATERIALS_AND_KEY_SCENE_FEATURES}.
<Video 1> provides {CAMERA_MOVEMENT_AND_TEMPORAL_REFERENCE}. Its characters and scenery are not reused.
<Audio 1> is the voice reference for <Subject 1> (S1), providing {VOICE_TIMBRE_PITCH_ACCENT_AND_DELIVERY}.

summary:
[reference generation + audio reference] A {DURATION}-second video featuring <Subject 1> in <Subject 2>. {TARGET_ACTION_OR_VISUAL_GOAL}. Camera behavior draws on <Video 1>, while newly generated speech follows the voice characteristics of <Audio 1> without copying its original recording.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - {IDENTITY_AND_APPEARANCE_FEATURES_TO_RETAIN}.
<Subject 2> (appears in [Shot 1]): fully_preserved - {ENVIRONMENTAL_FEATURES_TO_RETAIN}.
<Video 1> (camera movement and timing): {VISUAL_RETENTION_MARKER} - {REFERENCE_CAMERA_FEATURES_TO_FOLLOW_AND_ANY_INTENTIONAL_ADAPTATIONS}.
<Audio 1>: reference - {VOICE_CHARACTERISTICS_TO_FOLLOW_IN_NEWLY_GENERATED_SPEECH}.

detailed_description:
{OVERALL_VISUAL_STYLE_COLOR_PALETTE_AND_LIGHTING_TREATMENT}.
[Shot 1] <Subject 1> is {INITIAL_POSITION_POSE_AND_EXPRESSION} within <Subject 2>. {OPENING_COMPOSITION_SHOT_SIZE_AND_CAMERA_ANGLE}. {ACTION_ONSET_AND_CONTINUOUS_DEVELOPMENT}. The camera {CAMERA_MOVEMENT_DIRECTION_RANGE_AND_SPEED}, following {SPECIFIC_CAMERA_FEATURES} from <Video 1>. {VISIBLE_REACTIONS_AND_ENVIRONMENTAL_CHANGES}. <Subject 1> (S1), using {VOICE_CHARACTERISTICS} referenced from <Audio 1>, says with {DELIVERY}: <d>[{DIALOGUE_LANGUAGE}] {EXACT_DIALOGUE}</d>. {FINAL_ACTION_AND_ENDING_COMPOSITION}. The video remains one continuous shot without cuts.

overall_soundscape:
{AMBIENT_SOUNDS_PHYSICAL_ACTION_SOUNDS_AND_NONVERBAL_VOCAL_SOUNDS}

non_diegetic_music:
N/A` },
];
