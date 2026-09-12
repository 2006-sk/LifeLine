/**
 * Shared motion vocabulary for the command console.
 *
 * Three motions carry information on this screen: the disruption alert
 * arriving, the compromised banner taking over the action panel, and the plan
 * card swapping for a new one. Everything else is either instant or a colour
 * change. Values here are deliberately short (under 300ms) and always
 * ease-out, because every one of them is an element entering: ease-in would
 * delay the first frame, which is the frame the viewer is watching hardest.
 */

/** Strong ease-out. Matches --ease-out-expo in globals.css. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Strong ease-in-out, for things that move on screen rather than enter it. */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

export const DURATION = {
  /** Colour/press feedback. */
  press: 0.15,
  /** Small elements entering: facts, chips, checklist rows. */
  enter: 0.24,
  /** Panel-scale state swaps. */
  swap: 0.28,
  /** Exits are always faster than entrances: the decision is already made. */
  exit: 0.13,
} as const;

/**
 * Critically damped (damping = 2*sqrt(stiffness*mass)), so the alert settles
 * without overshoot. Springs are used here rather than a tween only because
 * stacked alerts reflow with `layout`, and a spring retargets mid-flight
 * where a keyframe would restart from zero.
 */
export const SPRING_SETTLE = { type: "spring", stiffness: 400, damping: 40, mass: 1 } as const;

/** Stagger between siblings entering together. Short enough to never gate a read. */
export const STAGGER = 0.04;
