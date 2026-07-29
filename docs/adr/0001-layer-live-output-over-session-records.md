# Layer live output over authoritative session records

Pi Web will continue treating Pi's persisted JSONL Session Record as the authority for completed history. Live output is a bounded, non-durable in-memory overlay expressed with the same AgentEvent and AgentMessage shapes already used by Web-managed sessions; pages load persisted history first, layer the current partial run onto the matching branch, and reload/reconcile from disk at persistence boundaries. This preserves existing browsing when live integration is absent or fails and avoids making Pi Web another session writer.
