# Route control to the claimed runtime

A Session Record may be claimed by one accepted terminal Pi runtime or one Web-managed runtime. When a terminal runtime is attached, Pi Web routes supported commands to it and never opens a duplicate in-process runtime; unsupported extension capabilities are disabled rather than emulated. A later terminal attachment to the same record is rejected from live integration, and may automatically reapply after the current claim is released, although this coordination cannot stop an unintegrated terminal from continuing to use the file.

Web control is explicit, page-scoped, short-lived, and non-exclusive with terminal input. Hub-accepted web commands are uniquely identified, serialized per instance, and deduplicated for that process lifetime; uncertain writes are not automatically retried. Busy submissions must retain explicit steer, follow-up, or abort-and-send intent.
