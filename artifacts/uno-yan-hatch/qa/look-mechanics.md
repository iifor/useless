# UNO Yan Look Mechanics

UNO Yan is a grounded humanoid character. Keep both feet, the lower torso, body scale, baseline, head size, and facial proportions stable. Her brown eyes lead each gaze with coordinated iris/eyeball rotation plus natural eyelid and eyebrow changes; the head and neck follow with a restrained turn or pitch, and the shoulders/upper torso follow only slightly. Never rotate, skew, mirror, or broadly warp the whole sprite.

Her short black bob may lag the head by a very small amount, and the open yellow cardigan may follow the upper torso subtly. The yellow triangular clip and candy-colored clips stay attached to the same physical side of her hair throughout the loop. They may become more or less visible through perspective and occlusion, but they must never swap sides, mirror, detach, or remain pasted to a fixed screen side.

## Cardinal pose families

- `000` / up: eyes rotate upward; upper eyelids and brows lift appropriately; chin and head pitch up with a small neck/upper-torso follow-through. Feet and pelvis remain anchored. The clips remain attached to their physical side and shift only with the head's perspective.
- `090` / screen-right: pupils, nose tip, face, and head turn unmistakably toward the viewer's screen-right edge. The screen-right turn must change cheek/ear visibility and occlude the far facial features naturally. The clips follow their physical side around the head and may be partly occluded; they do not jump or mirror.
- `180` / down: eyes rotate downward; lids and brows participate; chin and head pitch down with a restrained neck and upper-torso bow. Feet, pelvis, scale, and baseline remain fixed.
- `270` / screen-left: pupils, nose tip, face, and head turn unmistakably toward the viewer's screen-left edge, with the opposite cheek/ear visibility and occlusion from `090`. The asymmetric clips remain on the same physical side, becoming more or less visible only because of the turn.

## Continuity and motion budget

Each 22.5-degree step changes the eyes, eyelids/brows, head/neck angle, upper torso, bob, and clip perspective by roughly the same visual amount. Diagonals interpolate the adjacent cardinal families; they are not independent poses. `157.5` is one even step before down, `180`, and `337.5` is one even step before up, `000`. Keep expression, outfit, socks, cream shoes, silhouette, and registration consistent across all 16 poses.

Pupil-only motion is insufficient. Every cell must remain distinguishable from neutral at final pet size through coordinated eye, eyelid/brow, head, and subtle upper-body mechanics. Do not add labels, arrows, degree text, shadows, glow, scenery, props, or detached motion effects.
