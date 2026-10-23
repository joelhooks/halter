// Which skill page carries the principle a check holds. Checks link back to it, so a check that
// trips tells the agent what to read next.
export const SKILL_OF_CHECK: ReadonlyMap<string, string> = new Map([
  ["path-has-target", "value-paths"],
  ["target-is-our-object", "value-paths"],
  ["support-to-buyers", "email-sequence-architect"],
  ["trigger-has-evidence", "value-paths"],
  ["wait-has-timeout", "value-paths"],
  ["job-on-every-send", "email-sequence-architect"],
  ["pitch-to-buyer", "email-sequence-architect"],
  ["bridge-announces-pitch", "email-sequence-architect"],
  ["teach-before-fix", "launch-sequencer"],
  ["fake-deadline", "launch-sequencer"],
  ["deadline-names-event", "launch-sequencer"],
  ["rest-days", "launch-sequencer"],
  ["post-close-survey", "launch-runbook"],
  ["hard-from-inferred", "subscriber-intelligence"],
  ["else-on-every-vary", "survey-strategy"],
  ["value-declared", "survey-strategy"],
  ["few-values", "survey-strategy"],
  ["objection-has-fix", "proof-and-objections"],
  ["synthetic-live", "paid-attribution-kernel"],
]);
