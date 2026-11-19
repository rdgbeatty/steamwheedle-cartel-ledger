# Development runner network diagnosis

Investigated 2026-11-18 UTC. **Resolved for the resumed session:** the network-disabled flag is unset, DNS resolves EVE/Battle.net/Blizzard, EVE returned HTTP 200 and authenticated Blizzard auction requests succeeded. Workspace write limits remain enabled. The earlier observations below describe the restricted session, not the resumed session's current connectivity. See the [authenticated freshness exploration and implementation](collection-freshness.md).

## Observations

- Ubuntu 24.04 on WSL2; installed CLI reports `codex-cli 0.169.0`.
- The active command environment has `CODEX_SANDBOX_NETWORK_DISABLED=1`.
- Python IPv4 and IPv6 stream-socket creation both fail with `PermissionError(1, 'Operation not permitted')`, before making any connection or DNS request.
- Name resolution for Blizzard, Battle.net and an unrelated public host fails. Localhost resolves from local configuration.
- The command environment's IPv4 routing table is empty. No proxy environment variables are set.
- `/etc/resolv.conf` is WSL-generated. `/etc/wsl.conf` does not disable generated DNS. These facts do not establish a WSL resolver fault.
- `/home/rdbeatty/.codex/config.toml` contains no sandbox/network override. There is no project-local `.codex/config.toml`.
- The active session uses workspace-write with networking restricted, and sandbox escalation is unavailable under its current approval policy.

The immediate blocker is the execution sandbox's network restriction. Changing DNS servers, Blizzard credentials or auction API code cannot enable socket creation. The healthy host collector is further evidence against treating this as a machine-wide DNS outage. We have not tested the host's current resolver outside the sandbox, so a separate host issue is not ruled out.

## Comparison with the successful EVE spike

The owner correctly recalled earlier live API access. A follow-up audit of the saved EVE and WoW session metadata and selected public-probe command records establishes a specific permission difference:

| Setting | EVE repository task | This WoW task |
| --- | --- | --- |
| Sandbox | workspace-write | workspace-write |
| Sandbox network | disabled | disabled |
| Approval policy | on-request | granular |
| Sandbox approval requests | available | disabled (`sandbox_approval = false`) |

The EVE task successfully downloaded ESI's public OpenAPI specification on November 6 using an explicitly escalated command. On November 9, an explicitly escalated public history probe also succeeded; its result is summarized in the EVE repository's [history diagnosis](../../react-parse-goonmetrics/docs/discovery/09-history-pull-diagnosis.md). Those calls used `sandbox_permissions: require_escalated`. They were not evidence that the default restricted shell had unrestricted network access.

Retesting from the current command runner fails for EVE's public status endpoint, the same public history route, Blizzard's API/OAuth hosts and an unrelated control host. Socket creation is denied for both IPv4 and IPv6. This failure is not specific to WoW, API keys or either game's authentication.

The recorded CLI version changed from 0.167.0 at the EVE task's creation to 0.169.0 at this task's creation. That correlation does not establish an update as the cause. The historical records establish different effective task approval policies; they do not identify who or what selected them.

The narrow way to recover the earlier workflow is to allow sandbox/network approval requests for this task through its launcher, or explicitly enable workspace command networking before resuming. The current task cannot grant itself those permissions. No escalation was attempted during this diagnosis because its current policy explicitly disallows it.

Web browsing is a separate tool path. OpenAI's [networking guide](https://learn.chatgpt.com/docs/agent-approvals-security#traffic-outside-the-command-network-proxy) explicitly separates shell networking from web search and other tool connections. Being able to read documentation does not imply that a local script can reach ESI or Blizzard. The web tool also could not retrieve ESI's public JSON endpoint in this check; it remains useful for published documentation, not a replacement for authenticated API scripts.

## Configuration to check

OpenAI's [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) and [agent networking guide](https://learn.chatgpt.com/docs/agent-approvals-security) document the workspace-write network toggle. In the WSL user's `~/.codex/config.toml`, merge:

```toml
# Top level, before any [table] header:
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

This enables command networking while retaining workspace file restrictions. It is a proposed host setting, not a change made by this investigation. An existing sandbox or network table must be updated rather than duplicated.

For a CLI-only trial, leave persistent configuration alone and relaunch/resume from the ordinary WSL terminal:

```sh
codex -c 'sandbox_workspace_write.network_access=true' --sandbox workspace-write resume --last
```

The launching application, active permission profile, session override or managed requirements may impose a stronger restriction. If a relaunched session still reports disabled networking and cannot create sockets, change the launcher/workspace network permission or ask the policy administrator to permit command networking. A user configuration setting cannot override an enforced policy. [Managed policy reference](https://learn.chatgpt.com/docs/enterprise/managed-configuration).

If an enforced destination allowlist is used, the collector needs HTTPS access to `oauth.battle.net` and `us.api.blizzard.com`; the optional daily-sales adapter also uses `api.ahledger.com`. Web search is a separate tool connection and its success does not show that shell commands have network access.

## Recheck after relaunch

First run from the ordinary WSL terminal, then ask the agent to repeat inside its command runner:

```sh
getent ahosts us.api.blizzard.com
getent ahosts oauth.battle.net
curl -I --connect-timeout 5 --max-time 10 https://us.api.blizzard.com/
```

An HTTP response, including 401, 403 or 404, establishes DNS/TCP/TLS reachability; it does not establish OAuth validity or auction API behavior. No credentials are needed for this check. If the ordinary terminal works and the agent fails, keep investigating agent policy. Only if the ordinary terminal also fails should WSL/VPN/resolver troubleshooting become the next step.

## Collection freshness follow-up completed

After networking was restored, the agent queried the six auction endpoints, confirmed Last-Modified/conditional GET behavior and implemented a persisted 5–15 minute cooldown with a shared 600-request local hourly budget. See the [completed freshness work](collection-freshness.md). The collector fetches two documents for each of three houses: **six auction requests per normal collection/check**, not one per item. Catalog discovery, OAuth, retries and diagnostics also consume requests.

For scale: six auction requests every five minutes is 72 auction requests/hour; every fifteen minutes is 24/hour, excluding those other costs. A shared request budget still needs enforcement rather than relying only on a disabled UI button.

The authenticated probe established 304 support through If-Modified-Since, no ETag in the inspected responses, an advertised 24-hour cache lifetime and unsupported HEAD requests. Conditional requests still count against the local request budget. A 304 avoids transferring the full body but is not proof of real-time game data. Source publication time remains separate from the most recent check time.
