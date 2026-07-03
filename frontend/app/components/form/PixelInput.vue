<template>
  <ClientOnly>
    <div class="space-y-2">
      <label
        v-if="label"
        class="block text-sm font-pixel text-indigo-600"
      >
        {{ label }}
      </label>
      <div :class="wrapperClasses"><input
          v-bind="$attrs"
          :value="modelValue"
          @input="handleInput"
          :type="effectiveType"
          :placeholder="placeholder"
          :disabled="disabled"
          :autocomplete="autocomplete"
          :class="inputClasses" /><button
          v-if="type === 'password'"
          type="button"
          tabindex="-1"
          :aria-label="showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-indigo-600 transition-colors"
          @click="showPassword = !showPassword"><Icon :name="showPassword ? 'mdi:eye-off' : 'mdi:eye'" size="22" /></button></div>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
defineOptions({
  inheritAttrs: false
})

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: 'text',
    validator: (v: string) => ['text', 'password', 'email', 'date'].includes(v)
  },
  placeholder: {
    type: String,
    default: ''
  },
  label: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  autocomplete: {
    type: String,
    default: 'off'
  }
})

const emit = defineEmits(['update:modelValue'])

// Toggle de visibilité du mot de passe (bouton œil affiché uniquement si type === 'password').
const showPassword = ref(false)
const effectiveType = computed(() =>
  props.type === 'password' ? (showPassword.value ? 'text' : 'password') : props.type
)

const wrapperClasses = computed(() => [
  'pixel-input-wrapper',
  'pixel-notch',
  'group',
  'relative',
  'transition-colors',
  props.disabled ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'
])

const inputClasses = computed(() => [
  'w-full',
  'h-full',
  'pixel-notch',
  'bg-white',
  'px-4',
  'py-3',
  'font-pixel',
  'text-lg',
  'focus:outline-none',
  'focus:ring-0',
  // Réserve la place du bouton œil pour ne pas masquer le texte saisi.
  props.type === 'password' ? 'pr-11' : '',
  props.disabled ? 'bg-gray-100 cursor-not-allowed' : ''
])

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<style scoped>
.pixel-input-wrapper {
  padding: 4px;
}

.pixel-notch {
  clip-path: polygon(
    0px 6px, 6px 6px, 6px 0px,
    calc(100% - 6px) 0px, calc(100% - 6px) 6px, 100% 6px,
    100% calc(100% - 6px), calc(100% - 6px) calc(100% - 6px), calc(100% - 6px) 100%,
    6px 100%, 6px calc(100% - 6px), 0px calc(100% - 6px)
  );
}
</style>
