# Native terminal prerequisites (read-only assessment)

**Assessment date:** 2026-10-09. No package was installed and no system service was changed.

The implementation requires `tmux` to keep a CLI alive across browser disconnects and `ttyd` to expose that one tmux session to the authenticated local gateway. Both executables were reported absent from the target Mac mini PATH and Homebrew inventory in the verified starting state. The gateway fails closed until explicit absolute executable paths are configured.

| Formula | Official Homebrew metadata | License | Runtime dependencies |
|---|---|---|---|
| `ttyd` | Stable 1.7.7; Apple Silicon macOS bottle available | MIT | json-c, libevent, libuv, libwebsockets, openssl@3 |
| `tmux` | Stable 3.7c; Apple Silicon macOS bottle available | ISC | libevent, ncurses, utf8proc, jemalloc |

Sources: [Homebrew ttyd formula](https://formulae.brew.sh/formula/ttyd), [Homebrew tmux formula](https://formulae.brew.sh/formula/tmux.html), [upstream ttyd README](https://github.com/tsl0922/ttyd). Formula bottles are distributed through Homebrew; source-build paths have additional build dependencies. This assessment did not inspect the target machine's architecture/OS version or resolve actual installed dependency versions.

Both programs create host processes with the permissions of the logged-in macOS account. `ttyd` can run the configured `tmux attach-session` command; attached terminal input can execute arbitrary commands available to that account. The prior implementation placed ttyd's Basic credential in `--credential` argv. That is removed. Upstream documents `--credential USER[:PASSWORD]` as a CLI option and has no supported credential-file/stdin mechanism; its `--auth-header` option merely trusts a nonempty header supplied by a proxy, so it is not per-user authentication.

The upstream README documents `-i/--interface` accepting a UNIX-domain socket pathname and `-U/--socket-owner` for the socket owner. Current ttyd `server.c` only enables that mode when libwebsockets is compiled with `LWS_USE_UNIX_SOCK` or `LWS_WITH_UNIX_SOCK`; otherwise startup fails. The repository contains no target Mac mini ttyd binary to inspect, and the supplied host inventory says ttyd/tmux are absent. Therefore the actual Homebrew libwebsockets build capability, pathname interoperability, and websocket wire operation remain unknown. macOS's public `sockaddr_un.sun_path` member is 104 bytes, while an Apple DTS discussion describes a kernel-level longer-path form that requires nontrivial address handling; this implementation must use the conservative portable limit and verify the actual library client/server path before relying on it. `ttyd`'s own stored path buffer is 255 bytes, which does not prove the underlying library accepts that length.

A private UDS in an owner-only 0700 directory could restrict connections by OS UID and avoid any TCP listener if the target binary and client support are verified. It is not cryptographic per-user authentication and does not stop hostile programs running as the same macOS user from connecting to or inspecting the socket. `ttyd` also removes its configured socket pathname during cleanup, so safe lifecycle design must defend against path replacement before allowing a child to unlink anything. Until target build support, path safety, client transport, and process cleanup can be tested, the native adapter remains fail-closed. Binding to `lo0` or an unauthenticated loopback TCP socket is not an acceptable fallback.

## Approval and rollback gate

No `brew install`, `sudo`, package upgrade, or service modification is authorized by this implementation task. Before future native E2E, verify a short-path UDS using the actual Mac build and a supported Node client, review path ownership/replacement and same-UID risk, then implement and test child lifecycle. Any later installation/use of binaries requires separate owner approval. Verify target OS/architecture and current formula metadata before installation. Rollback must stop approved Hub processes and verify no child process or socket remains. Do not remove shared Homebrew dependencies without checking other users. Native terminal E2E is NOT VERIFIED.

This implementation iteration does not add a Unix-domain socket adapter or change the gateway transport contract. `NativeTtydAdapter` remains deliberately fail-closed. A private UDS can constrain access to the owning macOS UID only; it cannot protect against hostile same-UID processes. Reconsider implementation after the actual ttyd/libwebsockets build and Node WebSocket-to-UDS interoperability are demonstrated, including path-swap, ownership/mode, short-path, client-count, and child cleanup tests.
