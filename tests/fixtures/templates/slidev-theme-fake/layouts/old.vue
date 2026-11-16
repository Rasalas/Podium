<script>
export default {
  props: {
    photo: { type: String, default: '' },
    count: Number,
    dark: { type: Boolean },
  },
}
</script>
<template><div><slot /></div></template>
