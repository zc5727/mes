import assert from "node:assert/strict";
import test from "node:test";
import { calculateOee } from "./oee";

test("calculates OEE components and defect count", () => {
  const result = calculateOee({
    plannedTimeSeconds: 100,
    operatingTimeSeconds: 80,
    idealCycleTimeSeconds: 2,
    totalCount: 30,
    goodCount: 27,
  });

  assert.equal(result.availability, 0.8);
  assert.equal(result.performance, 0.75);
  assert.equal(result.quality, 0.9);
  assert.equal(result.oee, 0.54);
  assert.equal(result.defectCount, 3);
});

test("does not emit invalid ratios when a line has not started", () => {
  const result = calculateOee({
    plannedTimeSeconds: 0,
    operatingTimeSeconds: 0,
    idealCycleTimeSeconds: 2,
    totalCount: 0,
    goodCount: 0,
  });

  assert.deepEqual(
    { availability: result.availability, performance: result.performance, quality: result.quality, oee: result.oee },
    { availability: 0, performance: 0, quality: 1, oee: 0 },
  );
});
