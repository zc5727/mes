<template>
  <div class="workspace-shell">
    <FactoryDigitalTwin v-if="isTwinPage" />
    <BusinessPage v-else :page="businessPage" />
    <WorkspaceNavigation :active-route="route" :items="navigationItems" @navigate="navigate" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import FactoryDigitalTwin from '@/views/FactoryDigitalTwin.vue';
import BusinessPage from '@/views/BusinessPage.vue';
import WorkspaceNavigation, { type WorkspaceNavItem, type WorkspaceRoute } from '@/components/layout/WorkspaceNavigation.vue';

type BusinessRoute = Exclude<WorkspaceRoute, 'overview' | 'twin'>;

interface BusinessPageDefinition {
  key: BusinessRoute;
  index: string;
  title: string;
  description: string;
}

const navigationItems: readonly WorkspaceNavItem[] = [
  { key: 'overview', label: '生产总览', index: '01' },
  { key: 'twin', label: '数字孪生', index: '02' },
  { key: 'devices', label: '设备中心', index: '03' },
  { key: 'simulation', label: '仿真控制', index: '04' },
  { key: 'work-orders', label: '工单执行', index: '05' },
  { key: 'quality', label: '质量管理', index: '06' },
  { key: 'strategy', label: '策略分析', index: '07' },
  { key: 'system', label: '系统管理', index: '08' },
];

const businessPages: Record<BusinessRoute, BusinessPageDefinition> = {
  devices: { key: 'devices', index: '03', title: '设备中心', description: '查看设备状态、观测值和归属产线。数据来自统一 MES 快照。' },
  simulation: { key: 'simulation', index: '04', title: '仿真控制', description: '查看仿真运行上下文和服务端控制模式。控制动作仍遵循后端权限与审批边界。' },
  'work-orders': { key: 'work-orders', index: '05', title: '工单执行', description: '读取当前工单执行记录，为后续报工和异常闭环提供工作台入口。' },
  quality: { key: 'quality', index: '06', title: '质量管理', description: '读取质量记录和处理状态，异常数据由后端接口返回。' },
  strategy: { key: 'strategy', index: '07', title: '策略分析', description: '基于当前生产快照查看风险对象；策略仅分析展示，不自动控制设备。' },
  system: { key: 'system', index: '08', title: '系统管理', description: '查看数据库、消息链路和服务端控制模式健康状态。' },
};

const route = ref<WorkspaceRoute>(readRoute());
const isTwinPage = computed(() => route.value === 'overview' || route.value === 'twin');
const businessPage = computed(() => businessPages[isBusinessRoute(route.value) ? route.value : 'devices']);

function isBusinessRoute(value: WorkspaceRoute): value is BusinessRoute {
  return value !== 'overview' && value !== 'twin';
}

function readRoute(): WorkspaceRoute {
  const value = window.location.hash.replace(/^#\/?/, '') as WorkspaceRoute;
  return navigationItems.some((item) => item.key === value) ? value : 'overview';
}

function navigate(nextRoute: WorkspaceRoute) {
  if (nextRoute === route.value) return;
  window.location.hash = `/${nextRoute}`;
  route.value = nextRoute;
}

function handleHashChange() { route.value = readRoute(); }

onMounted(() => window.addEventListener('hashchange', handleHashChange));
onBeforeUnmount(() => window.removeEventListener('hashchange', handleHashChange));
</script>

<style scoped>
.workspace-shell { width: 100%; min-height: 100%; background: #07111f; }
</style>
