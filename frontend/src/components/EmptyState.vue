<template>
  <div class="empty-state">
    <span class="empty-icon">{{ icon }}</span>
    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="subtitle" class="empty-subtitle">{{ subtitle }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: string;
  title: string;
  subtitle?: string;
}>();
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 40px 20px;
}

.empty-icon {
  font-size: 48px;
  line-height: 1;
}

.empty-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.empty-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  max-width: 400px;
  line-height: 1.5;
  word-break: break-all;
}
</style>
