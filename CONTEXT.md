# Pi Web

Pi Web presents persisted Pi conversations and transient activity from active Pi runtimes in a browser.

## Language

**Session Record**:
A persisted Pi JSONL conversation tree and the authority for completed conversation history.
_Avoid_: Live stream, runtime state

**Web-managed Session**:
A Pi session whose active runtime is hosted by Pi Web.
_Avoid_: Observed Pi Instance

**Observed Pi Instance**:
A locally running interactive Pi TUI process connected to Pi Web for observation and optional control.
_Avoid_: Session, headless runtime

**Session Attachment**:
The current association between an Observed Pi Instance and one Session Record.
_Avoid_: Instance identity, permanent ownership

**Runtime Claim**:
Pi Web's designation of one accepted active runtime for a Session Record, preventing Pi Web integrations from adding a conflicting writer.
_Avoid_: File lock, browser selection

**Live Session**:
A Session Record with an accepted Observed Pi Instance whose transient activity can be shown in the normal conversation view.
_Avoid_: Process view, ephemeral session

**Live Activity**:
Transient lifecycle state and cumulative partial model output emitted at Pi's native incremental cadence before completed messages are persisted.
_Avoid_: Polling, synthetic tokenization

**Live Event**:
A best-effort, non-durable unit of Live Activity.
_Avoid_: Session entry, audit event

**Live Overlay**:
The bounded in-memory state of a current run layered after authoritative Session Record history until persistence is reconciled.
_Avoid_: Persisted message, event history

**Run Identity**:
A transient identifier and Session Record cursor correlating a run's Live Overlay with newly persisted entries.
_Avoid_: Session entry ID, prompt text

**Live Branch**:
The Session Record branch advanced by the current observed run and therefore eligible to display its Live Overlay.
_Avoid_: Selected historical branch

**Session Invalidation**:
A notice that persisted messages, tree, or metadata may have changed and should be reloaded through the authoritative reader.
_Avoid_: Replacement history, file watcher event

**Live Hub**:
The single per-OS-user Pi Web component that connects Observed Pi Instances with browser-facing live integration.
_Avoid_: Durable broker, system daemon

**Companion Extension**:
The explicitly installed global Pi extension that adapts ordinary interactive Pi processes to the Live Hub.
_Avoid_: Project extension, checkout symlink, postinstall hook

**Shared Control**:
Concurrent authority for the terminal and explicitly enabled web clients to command the same Observed Pi Instance.
_Avoid_: Exclusive takeover, ownership

**Observer**:
A web client receiving Live Activity without permission to command the observed runtime.
_Avoid_: Controller

**Controller**:
A terminal or authorized web client permitted to command an Observed Pi Instance.
_Avoid_: Owner, lease holder

**Control Capability**:
Short-lived, page-scoped permission to control one Observed Pi Instance while it remains attached to one Session Record.
_Avoid_: Login session, persistent permission

**Control Command**:
A uniquely identified operation sent by a web Controller to an Observed Pi Instance.
_Avoid_: Live Event, exactly-once operation

**Instance Capability**:
A control or state operation an Observed Pi Instance reports as available.
_Avoid_: Assumed command, compatibility shim

**Busy Submission**:
A submission made while Pi is processing whose intent is explicitly Steer, Follow-up, or Abort and Send.
_Avoid_: Automatic queueing

**Steer**:
A Busy Submission intended to redirect the current run at its next steering boundary.
_Avoid_: Immediate interruption, Follow-up

**Follow-up**:
A Busy Submission intended to run after current work settles.
_Avoid_: Steer

**Abort and Send**:
A Busy Submission intended to stop current work, await settlement, and then submit a new prompt.
_Avoid_: Concurrent abort and prompt

**Administrator**:
The single person authorized to access a protected Pi Web installation.
_Avoid_: Account, member, role

**Authenticated Web Client**:
A browser client with a valid bounded Administrator login session.
_Avoid_: Connected browser, trusted IP

**Integration Version**:
The exact matched Pi and Companion/Live Hub versions required for live integration.
_Avoid_: Compatibility range, best-effort version

**Local Integration Boundary**:
The Unix OS-user boundary trusted for local Companion-to-Hub communication.
_Avoid_: Browser authentication, hostile same-user isolation
