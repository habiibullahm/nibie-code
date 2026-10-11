# Chat workspace state ownership

`ChatWorkspace` remains the public component and composes four focused hooks:

| Owner | State and behavior |
| --- | --- |
| `use-chat-stream.ts` | Sending/streaming activity, stream controller, Stop epoch and pending acknowledgements, SSE reader, batched text, partial replies and terminal cleanup |
| `use-chat-recovery.ts` | Recovery target/epoch, accepted snapshot, latest server data reference and bounded authoritative polling |
| `use-conversation-navigation.ts` | Optimistic conversation/Room/draft selection, URL reconciliation, restored last-chat routing and navigation commands |
| `use-room-management.ts` | Room overrides, merged/sorted Room list, Room/brief/pin mutations and refresh |
| `ChatWorkspace` | Message/conversation optimistic reconciliation, submit/edit/regenerate/model/move transactions, shared busy guard, UI focus/scroll/dialog state and cross-domain reset/deletion callbacks |

The busy guard spans saves and model/move transactions as well as streaming, so
it stays in the component and is passed to the stream hook. State has one owner;
no context provider, external state library or new component entry point is added.

Every reader captures its conversation id and controller. Message writes stay
keyed by that id. Stop immediately releases the composer while its background
acknowledgement is pending; epoch/controller checks prevent late cleanup from
unlocking or aborting a newer reader. Navigation aborts another conversation's
live stream. Native history/Back/Forward selection also releases the old
controller immediately; two desktop/mobile regressions fail before that ownership
fix and pass afterward. Late reader errors cannot put the new selection into
recovery. Room/thread handoff retains the existing `/chat` lifetime policy;
leaving Chat aborts upstream. Recovery and stream timers dispose on cleanup.

Room deletion notifies the composing component to detach optimistic threads and
navigate away from the deleted selection. Navigation callbacks leave focus,
scroll and message-state resets with the view. Account defaults remain distinct
from a conversation's chosen mode.

## Verification

Existing desktop/mobile Stop, Retry, edit/Regenerate, Room create/move/delete,
search, model/default and reload tests exercise the unchanged public component.
A focused run passed 43 browser cases with four unavailable authenticated cases.
Full unit tests (1,329), typecheck and lint passed with the three existing
warnings. Final full-suite/build evidence belongs to the PR checks and closeout;
fixture passes are not signed-in or provider-quality acceptance.
