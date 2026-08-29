<template>
  <aside class="assistant panel" :class="{ 'is-collapsed': collapsed }" :style="assistantStyle">
    <div class="assistant-head" @pointerdown="startDrag">
      <div>
        <span class="eyebrow">MANUFACTURING COPILOT</span>
        <strong>厂长智能助手</strong>
      </div>
      <div class="assistant-head-actions">
        <span class="assistant-status"><i></i>在线</span>
        <button
          type="button"
          class="assistant-toggle"
          :aria-label="collapsed ? '展开智能助手' : '收起智能助手'"
          :title="collapsed ? '展开智能助手' : '收起智能助手'"
          @pointerdown.stop
          @click="toggleCollapsed"
        >
          {{ collapsed ? '展开' : '收起' }}
        </button>
      </div>
    </div>

    <template v-if="!collapsed">
      <div class="scope-bar">
      <span>当前视角</span>
      <strong>{{ selectedLine.name }}</strong>
      <small>{{ selectedLine.workshop }}</small>
      </div>

      <div class="conversation" aria-live="polite">
      <div v-for="message in messages" :key="message.id" class="chat-row" :class="`chat-${message.role}`">
        <span v-if="message.role === 'assistant'" class="assistant-avatar">AI</span>
        <div class="chat-bubble">
          <strong v-if="message.title">{{ message.title }}</strong>
          <p>{{ message.text }}</p>
          <button v-if="message.action" type="button" class="message-action" @click="runAction(message.action)">
            {{ message.action.label }}
          </button>
        </div>
      </div>
      </div>

      <div class="quick-prompts" aria-label="快捷提问">
      <button v-for="prompt in prompts" :key="prompt" type="button" @click="ask(prompt)">{{ prompt }}</button>
      </div>
      <form class="assistant-input" @submit.prevent="submitQuestion">
      <input v-model="question" placeholder="问问工厂现在发生了什么..." aria-label="向厂长智能助手提问" />
      <button type="submit">发送</button>
      </form>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { DeviceTelemetry, FactoryAlarm, ProductionLineTelemetry } from '@/types/factory';
import { createId } from '@/utils/time';

type ChatAction =
  | { type: 'device'; label: string; id: string }
  | { type: 'line'; label: string; id: string };

interface ChatMessage {
  id: string;
  role: 'assistant' | 'manager';
  text: string;
  title?: string;
  action?: ChatAction;
}

const props = defineProps<{
  selectedDevice: DeviceTelemetry | null;
  alarms: FactoryAlarm[];
  devices: DeviceTelemetry[];
  productionLines: ProductionLineTelemetry[];
  selectedLine: ProductionLineTelemetry;
}>();

const emit = defineEmits<{
  (event: 'select-device', id: string): void;
  (event: 'select-line', id: string): void;
}>();

const question = ref('');
const collapsed = ref(false);
const position = ref<{ left: number; top: number } | null>(null);
const dragState = ref<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
const prompts = ['现在最严重的问题？', '哪些订单有延期风险？', '切换到焊接线'];
const messages = ref<ChatMessage[]>([
  {
    id: createId('chat'),
    role: 'assistant',
    text: '当前视角已聚焦选中产线。你可以直接问我异常、设备状态或处置建议。'
  }
]);

const findLine = (input: string) => props.productionLines.find((line) => input.includes(line.name) || input.includes(line.id));

const findAlarmDevice = (alarm: FactoryAlarm) => props.devices.find((device) => device.id === alarm.sourceId || device.id === alarm.source)
  ?? props.selectedDevice
  ?? props.devices.find((device) => device.status === 'error' || device.status === 'warning');

const append = (message: Omit<ChatMessage, 'id'>) => {
  messages.value.push({ ...message, id: createId('chat') });
  if (messages.value.length > 8) messages.value.splice(0, messages.value.length - 8);
};

const respond = (input: string) => {
  append({ role: 'manager', text: input });
  const line = findLine(input);
  if (line && (input.includes('切换') || input.includes('查看') || input.includes('聚焦'))) {
    emit('select-line', line.id);
    append({
      role: 'assistant',
      title: `已切换至${line.name}`,
      text: `当前产线完成率 ${line.completionRate}%，设备在线 ${line.deviceOnline}。需要我继续查看异常设备吗？`
    });
    return;
  }

  const alarm = props.alarms.find((item) => item.level === 'critical') ?? props.alarms[0];
  const alarmDevice = alarm ? findAlarmDevice(alarm) : props.selectedDevice;
  if (input.includes('订单') || input.includes('延期')) {
    append({
      role: 'assistant',
      title: '订单延期风险：中等',
      text: `${props.selectedLine.name}当前完成率 ${props.selectedLine.completionRate}%。建议先处理${alarmDevice?.name ?? '异常设备'}，再重新评估派工。`,
      action: alarmDevice ? { type: 'device', label: '定位风险设备', id: alarmDevice.id } : undefined
    });
    return;
  }

  if (input.includes('方案') || input.includes('建议') || input.includes('怎么处理')) {
    append({
      role: 'assistant',
      title: '建议按“先隔离、再点检、后恢复”执行',
      text: `${alarmDevice?.name ?? '当前产线'}存在需要关注的状态。先保留工单上下文，安排点检并观察首件合格率，未经确认不直接停线。`,
      action: alarmDevice ? { type: 'device', label: '查看设备详情', id: alarmDevice.id } : undefined
    });
    return;
  }

  if (alarm) {
    append({
      role: 'assistant',
      title: alarm.level === 'critical' ? '当前最严重问题' : '当前重点关注',
      text: `${alarm.source}：${alarm.message}。建议先确认现场安全状态，再安排点检。`,
      action: alarmDevice ? { type: 'device', label: '定位异常设备', id: alarmDevice.id } : undefined
    });
    return;
  }

  append({
    role: 'assistant',
    title: '当前没有未处理告警',
    text: `${props.selectedLine.name}运行数据平稳。你可以继续询问设备温度、订单进度或产线切换。`
  });
};

const runAction = (action: ChatAction) => {
  if (action.type === 'device') emit('select-device', action.id);
  if (action.type === 'line') emit('select-line', action.id);
};

const ask = (prompt: string) => respond(prompt);
const submitQuestion = () => {
  const input = question.value.trim();
  if (!input) return;
  respond(input);
  question.value = '';
};

const assistantStyle = computed(() => position.value ? {
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
  right: 'auto'
} : undefined);

const clampPosition = (left: number, top: number) => {
  const width = collapsed.value ? 128 : 310;
  const maxLeft = Math.max(12, window.innerWidth - width - 12);
  const maxTop = Math.max(12, window.innerHeight - 64);
  return {
    left: Math.min(Math.max(12, left), maxLeft),
    top: Math.min(Math.max(12, top), maxTop)
  };
};

const startDrag = (event: PointerEvent) => {
  if (event.button !== 0) return;
  const element = event.currentTarget as HTMLElement;
  const rect = element.parentElement?.getBoundingClientRect();
  if (!rect) return;
  position.value = { left: rect.left, top: rect.top };
  dragState.value = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  window.addEventListener('pointermove', drag);
  window.addEventListener('pointerup', stopDrag);
  event.preventDefault();
};

const drag = (event: PointerEvent) => {
  if (!dragState.value || event.pointerId !== dragState.value.pointerId) return;
  position.value = clampPosition(event.clientX - dragState.value.offsetX, event.clientY - dragState.value.offsetY);
};

const stopDrag = (event: PointerEvent) => {
  if (!dragState.value || event.pointerId !== dragState.value.pointerId) return;
  dragState.value = null;
  window.removeEventListener('pointermove', drag);
  window.removeEventListener('pointerup', stopDrag);
  if (position.value) {
    try {
      localStorage.setItem('mes-assistant-position', JSON.stringify(position.value));
    } catch {
      // Desktop shells may disable persistent storage; dragging still works in memory.
    }
  }
};

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value;
  if (position.value) position.value = clampPosition(position.value.left, position.value.top);
};

const handleResize = () => {
  if (position.value) position.value = clampPosition(position.value.left, position.value.top);
};

onMounted(() => {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('mes-assistant-position');
  } catch {
    // Continue with the default position when storage is unavailable.
  }
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as { left?: number; top?: number };
      if (typeof parsed.left === 'number' && typeof parsed.top === 'number') position.value = clampPosition(parsed.left, parsed.top);
    } catch {
      try {
        localStorage.removeItem('mes-assistant-position');
      } catch {
        // Ignore storage cleanup failures in restricted desktop contexts.
      }
    }
  }
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('pointermove', drag);
  window.removeEventListener('pointerup', stopDrag);
});
</script>

<style scoped>
.assistant { position:absolute; right:380px; top:92px; z-index:4; display:flex; width:310px; max-height:calc(100vh - 234px); flex-direction:column; padding:14px; color:#dcecff; transition: box-shadow .2s ease, width .2s ease; }
.assistant.is-collapsed { width:128px; }
.assistant.is-collapsed .assistant-head > div:first-child { display:none; }
.assistant.is-collapsed .assistant-head { justify-content:flex-end; }
.assistant-head,.assistant-status,.assistant-input,.assistant-head-actions { display:flex; align-items:center; }
.assistant-head { justify-content:space-between; gap:12px; cursor:grab; user-select:none; touch-action:none; }
.assistant-head:active { cursor:grabbing; }
.assistant-head-actions { gap:8px; }
.eyebrow { display:block; color:#67d5ff; font-size:9px; letter-spacing:1.2px; }
.assistant-head strong { display:block; margin-top:4px; color:#eef8ff; font-size:15px; }
.assistant-status { gap:6px; color:#72f5ba; font-size:11px; }
.assistant-status i { width:7px; height:7px; border-radius:50%; background:#39f5b6; box-shadow:0 0 10px #39f5b6; }
.assistant-toggle { min-width:44px; min-height:32px; padding:4px 7px; border:1px solid rgba(104,200,255,.3); background:rgba(29,143,255,.1); color:#a9d7ff; cursor:pointer; font-size:10px; }
.assistant-toggle:hover,.assistant-toggle:focus-visible { border-color:#68c8ff; background:rgba(29,143,255,.2); outline:none; }
.scope-bar { display:flex; align-items:baseline; gap:7px; margin:12px 0 8px; padding:8px 9px; border:1px solid rgba(104,200,255,.2); background:rgba(29,143,255,.08); }
.scope-bar span,.scope-bar small { color:#7eaed6; font-size:10px; }.scope-bar strong { color:#eef8ff; font-size:12px; }.scope-bar small { margin-left:auto; }
.conversation { display:flex; min-height:110px; flex:1; flex-direction:column; gap:8px; overflow-y:auto; padding-right:3px; scrollbar-width:thin; }
.chat-row { display:flex; align-items:flex-start; gap:8px; }.chat-manager { justify-content:flex-end; }.chat-manager .chat-bubble { background:rgba(29,143,255,.14); border-color:rgba(104,200,255,.26); }
.chat-bubble { max-width:90%; padding:9px 10px; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.055); }.chat-bubble strong { display:block; margin-bottom:4px; color:#ffe3a1; font-size:11px; }.chat-bubble p { margin:0; color:#b8d8f4; font-size:12px; line-height:1.5; }
.assistant-avatar { display:grid; width:26px; height:26px; flex:0 0 auto; place-items:center; border:1px solid #4a90e2; color:#9ed2ff; font-size:10px; font-weight:800; }
.message-action { margin-top:8px; padding:5px 7px; border:1px solid rgba(104,200,255,.3); background:transparent; color:#a9d7ff; cursor:pointer; font-size:10px; }
.quick-prompts { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }.quick-prompts button { padding:6px 8px; border:1px solid rgba(104,200,255,.3); background:rgba(29,143,255,.1); color:#a9d7ff; cursor:pointer; font-size:11px; }.quick-prompts button:hover,.message-action:hover { border-color:#68c8ff; background:rgba(29,143,255,.2); }
.assistant-input { gap:7px; margin-top:12px; }.assistant-input input { min-width:0; flex:1; padding:8px 9px; border:1px solid rgba(111,183,255,.2); outline:none; background:rgba(0,0,0,.18); color:#dcecff; font-size:12px; }.assistant-input input:focus { border-color:#4a90e2; }.assistant-input button { padding:8px 11px; border:0; background:#1d8fff; color:#fff; cursor:pointer; font-size:12px; }
@media (prefers-reduced-motion: reduce) { .assistant { transition:none; } }
@media (max-width: 900px) { .assistant { right:12px; top:88px; width:min(310px, calc(100vw - 24px)); } .assistant.is-collapsed { width:128px; } }
</style>
