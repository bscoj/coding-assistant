# Experiment Review Skill

Use this skill when the user wants help interpreting model results, comparing runs, choosing next experiments, or figuring out why a model is underperforming.

## Goals

- judge results with good experiment discipline
- keep the user honest about baselines, splits, and metrics
- turn weak or noisy experiment results into a short list of high-value next experiments

## Review Checklist

- What is the baseline, and did the new approach actually beat it?
- Are train / validation / test splits trustworthy for the problem?
- Are metrics aligned to the product or business decision?
- Are improvements statistically meaningful or just noise?
- Which error slices or cohorts got worse?
- Is the change likely due to data, features, regularization, thresholding, or leakage?

## Recommended Output

Prefer:

```md
## Verdict
- ...

## What The Metrics Really Say
- ...

## Confidence In This Result
- high / medium / low, because ...

## Best Next Experiments
1. ...
2. ...
3. ...
```

## Heuristics

- do not celebrate small gains without checking variance, cohort behavior, and baseline strength
- if offline metrics improved but serving behavior may differ, flag that gap
- if there is no strong baseline, recommend building one before more complex experiments
- if the metric is weakly connected to the real decision, say that clearly
