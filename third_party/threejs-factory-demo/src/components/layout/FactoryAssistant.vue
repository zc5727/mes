<template>
  <aside class="assistant panel">
    <div class="assistant-head">
      <div>
        <span class="eyebrow">MANUFACTURING COPILOT</span>
        <strong>厂长智能助手</strong>
      </div>
      <span class="assistant-status"><i></i>在线</span>
    </div>
    <div class="assistant-message">
      <span class="assistant-avatar">AI</span>
      <p>当前整体生产平稳，但焊接工作站存在温度波动。我可以帮你分析影响范围或模拟调度方案。</p>
    </div>
    <div class="quick-prompts">
      <button v-for="prompt in prompts" :key="prompt" type="button" @click="ask(prompt)">{{ prompt }}</button>
    </div>
    <div v-if="answer" class="assistant-answer">
      <strong>{{ answer.title }}</strong>
      <p>{{ answer.body }}</p>
      <button type="button" @click="emit('select-device', answer.deviceId)">定位设备</button>
    </div>
    <form class="assistant-input" @submit.prevent="submitQuestion">
      <input v-model="question" placeholder="问问工厂现在发生了什么..." aria-label="向厂长智能助手提问" />
      <button type="submit">发送</button>
    </form>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { DeviceTelemetry, FactoryAlarm } from '@/types/factory';

const props = defineProps<{ selectedDevice: DeviceTelemetry | null; alarms: FactoryAlarm[] }>();
const emit = defineEmits<{ (event: 'select-device', id: string): void }>();
const question = ref('');
const answer = ref<{ title: string; body: string; deviceId: string } | null>(null);
const prompts = ['现在最严重的问题？', '哪些订单有延期风险？', '给我一个处理方案'];

const respond = (input: string) => {
  const device = props.selectedDevice ?? { id: 'DEV-03', name: '焊接工作站', warning: '焊接温度波动' };
  if (input.includes('订单') || input.includes('延期')) {
    answer.value = { title: '订单A存在轻微延期风险', body: '焊接工作站节拍下降约12%，建议将30%的任务切换到备用工位，预计可避免约2小时延期。', deviceId: device.id };
  } else if (input.includes('方案')) {
    answer.value = { title: '建议执行方案：切换备用工位', body: '保留当前工单数据，调整后续派工，并持续观察焊接温度和首件合格率。', deviceId: device.id };
  } else {
    answer.value = { title: '当前重点异常：焊接工作站', body: '设备处于预警状态，建议安排点检并检查温度传感器；系统暂不建议直接停线。', deviceId: device.id };
  }
};
const ask = (prompt: string) => respond(prompt);
const submitQuestion = () => { if (question.value.trim()) { respond(question.value.trim()); question.value = ''; } };
</script>

<style scoped>
.assistant { position:absolute; right:380px; top:92px; z-index:4; width:310px; padding:14px; color:#dcecff; }
.assistant-head,.assistant-status,.assistant-input,.assistant-message { display:flex; align-items:center; }
.assistant-head { justify-content:space-between; gap:12px; }
.eyebrow { display:block; color:#67d5ff; font-size:9px; letter-spacing:1.2px; }
.assistant-head strong { display:block; margin-top:4px; color:#eef8ff; font-size:15px; }
.assistant-status { gap:6px; color:#72f5ba; font-size:11px; }
.assistant-status i { width:7px; height:7px; border-radius:50%; background:#39f5b6; box-shadow:0 0 10px #39f5b6; }
.assistant-message { align-items:flex-start; gap:8px; margin:14px 0 10px; padding:10px; background:rgba(255,255,255,.055); }
.assistant-avatar { display:grid; width:26px; height:26px; flex:0 0 auto; place-items:center; border:1px solid #4a90e2; color:#9ed2ff; font-size:10px; font-weight:800; }
.assistant-message p,.assistant-answer p { margin:0; color:#b8d8f4; font-size:12px; line-height:1.5; }
.quick-prompts { display:flex; flex-wrap:wrap; gap:6px; }
.quick-prompts button,.assistant-answer button { padding:6px 8px; border:1px solid rgba(104,200,255,.3); background:rgba(29,143,255,.1); color:#a9d7ff; cursor:pointer; font-size:11px; }
.quick-prompts button:hover,.assistant-answer button:hover { border-color:#68c8ff; background:rgba(29,143,255,.2); }
.assistant-answer { margin-top:10px; padding:10px; border-left:3px solid #ffc857; background:rgba(255,200,87,.08); }
.assistant-answer strong { display:block; margin-bottom:5px; color:#ffe3a1; font-size:12px; }
.assistant-answer button { margin-top:9px; color:#ffe3a1; border-color:rgba(255,200,87,.35); background:transparent; }
.assistant-input { gap:7px; margin-top:12px; }
.assistant-input input { min-width:0; flex:1; padding:8px 9px; border:1px solid rgba(111,183,255,.2); outline:none; background:rgba(0,0,0,.18); color:#dcecff; font-size:12px; }
.assistant-input input:focus { border-color:#4a90e2; }
.assistant-input button { padding:8px 11px; border:0; background:#1d8fff; color:#fff; cursor:pointer; font-size:12px; }
</style>
