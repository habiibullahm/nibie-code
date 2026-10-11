# Settings V2 screenshots

Current mobile horizontal tabs, captured from `/preview` in touch-enabled Chromium emulation. These demonstrate layout only, without authentication or provider calls. The selected tab stays visible while section content scrolls separately; the next tab can be partially visible to indicate horizontal scrolling.

| Mobile width | Dark | Light |
| --- | --- | --- |
| 320×844 | [Dark tabs](mobile-320-dark-tabs.png) | [Light tabs](mobile-320-light-tabs.png) |
| 390×844 | [Dark tabs](mobile-390-dark-tabs.png) | [Light tabs](mobile-390-light-tabs.png) |

## Earlier signed-in captures

The following screenshots predate the mobile tab-strip change. Desktop remains representative; mobile screenshots show the former section picker and are retained as historical account-flow evidence.

Captured from the local signed-in application with disposable Supabase accounts. Model choices use loopback-only configuration fixtures; no model requests were made. The existing fonts, theme tokens and typography are used. The development indicator is hidden for capture.

| View | Dark | Light |
| --- | --- | --- |
| Desktop General (1440×900; 800px dialog) | [Dark](desktop-dark-general.png) | [Light](desktop-light-general.png) |
| Desktop AI & Models | [Dark](desktop-dark-ai.png) | [Light](desktop-light-ai.png) |
| Mobile General (390×844) | [Dark](mobile-dark-general.png) | [Light](mobile-light-general.png) |
| Mobile AI & Models | [Dark](mobile-dark-ai.png) | [Light](mobile-light-ai.png) |

Former expanded section picker (narrow desktop Chromium, not physical-device QA): [320px dark](mobile-320-dark-picker.png), [320px light](mobile-320-light-picker.png), [390px dark](mobile-390-dark-picker.png), [390px light](mobile-390-light-picker.png). This navigation has been replaced by the horizontal tabs above.

Additional mobile views: [saved memory](mobile-light-memory.png), [live usage balance](mobile-light-usage.png), and [privacy after scrolling at 320×740](mobile-320-light-privacy.png). The usage reset date is supplied by the local database at capture time.
