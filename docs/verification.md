# Verification

This file distinguishes actual runtime tests from personal account use.

| Layer              | Evidence                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Core + OAuth + MCP | `npm test` exercises isolated databases and HTTP servers                                                                       |
| UI                 | `npm run test:e2e` runs a full memory → workflow → review → feedback loop on desktop and mobile                                |
| Actual OpenClaw    | `artifacts/openclaw-verification.json` records real Gateway tool execution and an authenticated MCP → OpenClaw → Dingdong call |
| Cloud              | Deployment and persistence verification are recorded after a successful release                                                |
| Personal GPT dots  | Only mark verified after the user's real dot successfully calls the deployed plugin and the resulting records are checked      |

No synthetic test is evidence of an external user account connection. The OpenClaw host is used without a model call in this MVP. Document generation is deterministic template rendering. A successful run is evidence that those supported steps completed, not evidence that an external publication or delivery occurred.
