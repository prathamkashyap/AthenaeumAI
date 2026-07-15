import { createJobQueue } from "../../utils/jobQueue.js";
import { QueueEnqueueError } from "../../utils/errors.js";
import { jest } from "@jest/globals";

describe("jobQueue.enqueue", () => {
  test("returns the BullMQ job and applies bounded retention", async () => {
    const job = { id: "42", name: "Index material" };
    const queue = { add: jest.fn().mockResolvedValue(job) };
    const producer = createJobQueue({ queue, testMode: false });

    await expect(producer.enqueue("Index material", {
      type: "INDEX_MATERIAL",
      data: { materialId: "material-1" },
    }, {
      deduplicationId: "index-material:material-1",
    })).resolves.toBe(job);

    expect(queue.add).toHaveBeenCalledWith("Index material", expect.any(Object), expect.objectContaining({
      attempts: 3,
      removeOnComplete: { count: 500, age: 7 * 24 * 60 * 60 },
      removeOnFail: { count: 500, age: 30 * 24 * 60 * 60 },
      deduplication: { id: "index-material:material-1" },
    }));
  });

  test("throws a typed error when BullMQ rejects the enqueue", async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error("Redis unavailable")) };
    const producer = createJobQueue({ queue, testMode: false });

    await expect(producer.enqueue("Index material", {
      type: "INDEX_MATERIAL",
      data: { materialId: "material-1" },
    })).rejects.toBeInstanceOf(QueueEnqueueError);
  });

  test("rejects non-serializable function payloads before reaching BullMQ", async () => {
    const queue = { add: jest.fn() };
    const producer = createJobQueue({ queue, testMode: false });

    await expect(producer.enqueue("Invalid", () => {})).rejects.toBeInstanceOf(QueueEnqueueError);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
