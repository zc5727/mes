import assert from "node:assert/strict";
import test from "node:test";
import { MqttPublisher, parseMqttUrl } from "./publisher";

test("MQTT endpoint configuration is explicit and rejects unsupported transport schemes", () => {
  assert.equal(parseMqttUrl("mqtt://127.0.0.1:1883"), "mqtt://127.0.0.1:1883");
  assert.equal(parseMqttUrl("mqtts://broker.example.test:8883"), "mqtts://broker.example.test:8883");
  assert.throws(() => parseMqttUrl("http://127.0.0.1:1883"), /mqtt:\/\/ or mqtts:\/\//);
  assert.throws(() => parseMqttUrl("not-a-url"), /valid URL/);
  assert.throws(() => MqttPublisher.connect("mqtt://127.0.0.1:1883", 99), /timeoutMs must be/);
});

test("MQTT connection failure is bounded instead of silently becoming connected", async () => {
  await assert.rejects(
    MqttPublisher.connect("mqtt://127.0.0.1:1", 100),
    /MQTT connection timed out|ECONNREFUSED|connect/i,
  );
});
