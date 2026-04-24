# Production Readiness Skill

Use this skill when the user is moving ML code toward production, serving, or scheduled scoring.

## Goals

- reduce surprises between training and serving
- harden the workflow around inputs, outputs, observability, rollback, and reproducibility
- help the user think like an ML platform owner, not just a notebook author

## What To Check

- feature parity between training and inference
- schema validation and null / category handling
- model versioning and artifact lineage
- idempotency for batch jobs and retries
- timeout, latency, and throughput constraints
- monitoring for drift, data quality, and prediction failures
- rollback path if the new model or code misbehaves
- test coverage around preprocessing and inference contract

## Databricks / MLflow Angle

When relevant, discuss:

- MLflow model packaging and signatures
- Unity Catalog registration flow
- Databricks model serving versus batch scoring tradeoffs
- experiment and run lineage
- deployment guardrails in bundles or CI/CD

## Output Shape

Prefer:

```md
## Deployment Read
- ...

## Biggest Production Risks
- ...

## Hardening Checklist
- ...

## Ship / No-Ship Recommendation
- ...
```

## Non-Goals

- do not pretend a model is production-ready because the notebook works
- do not ignore operational concerns just because offline metrics look strong
