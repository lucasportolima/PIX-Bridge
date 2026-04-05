// ──────────────────────────────────────────────────────────────────────────────
// MongoDB Replica Set Init Script
// Runs inside the mongo-init one-shot container.
// Initiates rs0 replica set on the primary node.
//
// Replica set is REQUIRED for multi-document ACID transactions (NestJS uses
// mongoose sessions which need a replica set — even with a single node).
// ──────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initReplicaSet() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const status = rs.status();
      // If we get here without an error, rs is already initiated
      print(`[mongo-init] Replica set already initiated (state: ${status.myState}). Skipping.`);
      return;
    } catch (e) {
      // Error code 94 = NotYetInitialized — expected on first run
      if (e.code !== 94) {
        print(`[mongo-init] Unexpected rs.status() error (code: ${e.code}): ${e.message}`);
      }
    }

    try {
      print(`[mongo-init] Attempt ${attempt}/${MAX_RETRIES}: initiating rs0...`);
      const result = rs.initiate({
        _id: "rs0",
        members: [
          { _id: 0, host: "mongodb:27017", priority: 1 }
        ]
      });

      if (result.ok === 1) {
        print("[mongo-init] ✓ Replica set rs0 initiated successfully.");
        // Brief wait for election to complete
        sleep(2000);

        const finalStatus = rs.status();
        print(`[mongo-init] Primary elected: ${finalStatus.members[0].stateStr}`);
        return;
      }

      print(`[mongo-init] rs.initiate() returned ok=0: ${JSON.stringify(result)}`);
    } catch (initErr) {
      print(`[mongo-init] rs.initiate() error: ${initErr.message}`);
    }

    sleep(RETRY_DELAY_MS);
  }

  throw new Error("[mongo-init] ✗ Failed to initiate replica set after max retries.");
}

initReplicaSet();
