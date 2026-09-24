# Dynamic Questioning Engine

Use this reference to decide what to ask next. Do not expose the whole internal map or scoring process unless it helps the user correct the analysis.

## 1. Maintain the Requirement Map

Track these fields as confirmed, inferred, assumed, contradicted, or unknown:

| Dimension | What to establish |
| --- | --- |
| Request source | Who raised it and who owns the business decision |
| Primary problem | What work or outcome is failing, independent of a preferred feature |
| User and affected roles | Who acts, configures, decides, receives, or is affected |
| Concrete scenario | Trigger, time, place or channel, action, expected result, actual result |
| Current workflow | Input, steps, tools, handoffs, output, workaround, and next consumer |
| Evidence | Cases, data, screenshots, records, market signals, or explicit absence |
| Impact | Frequency, volume, time, cost, revenue, conversion, risk, or experience |
| Desired outcome | What should change and why it matters now |
| Success criteria | What observable result would show the problem is solved |
| Scope | Required branch, phase, users, products, regions, and exclusions |
| Constraints | Policy, source rights, money, permissions, existing-system facts, deadlines |
| Branches | Different workflows, users, starting conditions, goals, or maturity stages |
| Open decisions | Strong blockers, deferrable questions, and future extensions |

Do not require every field for a small request. Require every field that can materially change downstream design or acceptance.

## 2. Select the Next Question

Choose the unknown or contradiction with the highest combined effect on:

1. problem definition;
2. business value;
3. current scope;
4. downstream design direction;
5. acceptance meaning;
6. legal, financial, security, or operational risk.

Prefer questions that remove several uncertainties at once. Ask one primary question per turn. Combine details only when they describe one inseparable event.

Bad:

> Who uses it, when, where, how often, what fields, what permissions, what metrics, and when should it launch?

Better:

> Please walk me through the most recent time this happened, from receiving the task to handing off the result. Who was involved, and where did the process get stuck?

## 3. Question Patterns

### A. Move from a symptom to the affected work

Use when the user says something is insufficient, slow, inconvenient, or inaccurate.

- "What work cannot be completed well because of this?"
- "What happens after this problem occurs?"
- "Is this the problem itself, or the reason another result is poor?"

Do not immediately design a library, button, automation, or configuration.

### B. Reconstruct a real occurrence

Use when the answer is abstract or generalized.

- "What was the most recent real case?"
- "What triggered it, what did you do, and what result did you get?"
- "Where did you switch tools, wait, redo work, or ask another person?"

Use the case to establish facts. Do not assume it represents every case; ask about frequency and variation later.

### C. Reconstruct the current workflow

Use when the issue spans roles or handoffs.

Ask the user to narrate:

```text
trigger → input → action → decision → output → handoff → business result
```

For each step, capture the actor, tool, information, time, failure, and workaround only when relevant.

### D. Separate outcome from solution

Use when the user proposes a feature, model, page, material library, data source, or integration.

- "If we temporarily set this solution aside, what result must still be achieved?"
- "Is this method mandatory, or is it one idea for reaching the outcome?"
- "What would make another method unacceptable?"

Preserve mandatory business constraints; defer product and technical choices.

### E. Split requirement branches

Use when statements refer to different starting conditions or workflows.

- "Does this happen when extending an existing product, creating one from zero, or both?"
- "Are product design and page-image production the same workflow here?"
- "Which branch must this phase solve first?"

Create a parent requirement with separate child branches. Never average incompatible branches into one vague requirement.

### F. Test with a counterexample

Use after a provisional summary.

- "Would this understanding still hold if there were no existing reference product?"
- "Is there a user or region where this rule does not apply?"
- "What is the most common exception?"

Counterexamples reveal hidden scope and should not be used to expand the phase automatically.

### G. Establish evidence and impact

- "How many times did this happen in the last relevant period?"
- "How much manual time or rework does one case require?"
- "Which result is affected: revenue, conversion, cost, risk, delivery, or user experience?"
- "What evidence supports that conclusion?"

Record "no evidence yet" honestly. For a predicted opportunity, ask for market evidence or a low-cost validation plan.

### H. Define success without designing the feature

- "What observable change would make you say this problem is solved?"
- "What is the current baseline, and what direction or threshold is expected?"
- "Who decides that the result is acceptable?"

Success criteria may be qualitative when measurement is genuinely unavailable, but must still be observable and reviewable.

### I. Surface constraints and risk

Ask only when relevant:

- "Can these external materials legally be collected and reused?"
- "Does this involve customer data, store accounts, financial data, or cross-account isolation?"
- "Which existing system behavior has been verified, and which is only expected?"
- "What must remain unchanged?"

Do not turn this into technical solution design.

### J. Reflect and confirm

Use every two or three substantive rounds and before completion:

> My current understanding is: [problem], affecting [user] in [scenario]. The present bottleneck is [bottleneck], causing [impact]. This phase aims to achieve [outcome], and does not include [non-scope]. I am still uncertain about [gap]. Which part is inaccurate or incomplete?

Ask for correction, not a perfunctory "yes."

## 4. Avoid Leading Questions

Ask open first, hypothesis second.

Leading:

> So you need AI to predict that 80% of users will like this design, right?

Non-leading:

> How do you currently judge whether a design is worth developing? Which part of that judgment do you want to improve?

If a hypothesis can accelerate understanding, label it:

> One possible interpretation is that the main problem is incomplete search coverage rather than image generation. What evidence supports or contradicts that?

Offer options only after the user cannot name the distinction, and always allow correction.

## 5. Handle Multi-Stakeholder Meetings

1. Attribute facts and preferences to the speaker or role; do not treat one person's statement as organizational consensus.
2. Record disagreements explicitly.
3. Identify the business decision owner.
4. Separate the requirement owner, daily user, affected party, and solution provider.
5. Ask which branch is in scope when participants introduce adjacent needs.
6. Summarize decisions, unresolved points, owners, and evidence requests at the end.

## 6. Stop Conditions

Stop asking and produce a confirmed analysis only when the completion gate in `SKILL.md` passes.

Pause with a draft when a strong blocker remains. Strong blockers include ambiguity about the goal, primary user, current branch, mandatory scope, decision ownership, money movement, permission boundary, compliance constraint, or acceptance meaning.

Keep wording, minor formatting, and downstream implementation detail out of the blocker list.
