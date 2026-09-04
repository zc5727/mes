<template>
  <nav class="workspace-nav panel" aria-label="MES 功能导航">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="workspace-nav__item"
      :class="{ active: activeRoute === item.key }"
      :aria-current="activeRoute === item.key ? 'page' : undefined"
      @click="$emit('navigate', item.key)"
    >
      <span class="workspace-nav__index">{{ item.index }}</span>
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
export type WorkspaceRoute = 'overview' | 'twin' | 'devices' | 'simulation' | 'work-orders' | 'quality' | 'strategy' | 'system';

export interface WorkspaceNavItem {
  key: WorkspaceRoute;
  label: string;
  index: string;
}

defineProps<{
  activeRoute: WorkspaceRoute;
  items: readonly WorkspaceNavItem[];
}>();

defineEmits<{
  (event: 'navigate', route: WorkspaceRoute): void;
}>();
</script>

<style scoped>
.workspace-nav {
  position: fixed;
  top: 82px;
  left: 50%;
  z-index: 30;
  display: flex;
  max-width: calc(100vw - 40px);
  overflow-x: auto;
  transform: translateX(-50%);
  scrollbar-width: none;
}

.workspace-nav::-webkit-scrollbar { display: none; }

.workspace-nav__item {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  border: 0;
  border-right: 1px solid rgba(111, 183, 255, 0.14);
  background: transparent;
  color: #7eaed6;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.workspace-nav__item:last-child { border-right: 0; }
.workspace-nav__item:hover,
.workspace-nav__item.active { background: rgba(29, 143, 255, 0.18); color: #eef8ff; }
.workspace-nav__index { color: #68c8ff; font-size: 9px; font-variant-numeric: tabular-nums; }

@media (max-width: 900px) {
  .workspace-nav { top: 80px; left: 20px; max-width: calc(100vw - 40px); transform: none; }
}
</style>
