<script>
import { useQuery, useResult } from '@vue/apollo-composable'
import gql from 'graphql-tag'
import ProjectTypeLogo from './ProjectTypeLogo.vue'

export default {
  components: {
    ProjectTypeLogo,
  },

  inheritAttrs: false,

  model: {
    prop: 'value',
    event: 'update',
  },

  setup () {
    const { result } = useQuery(gql`
      query projectTypes {
        projectTypes {
          id
          name
          logo
        }
      }
    `)

    const projectTypes = useResult(result, [])

    return {
      projectTypes,
    }
  },
}
</script>

<template>
  <VSelect
    v-slot="{ option }"
    v-bind="$attrs"
    :options="projectTypes.map(pt => ({
      value: pt.id,
      searchText: pt.name,
      data: pt,
    }))"
    searchable
    optionClass="p-2"
    v-on="$listeners"
  >
    <ProjectTypeLogo
      :projectType="option.data"
      class="w-5 h-5 mr-2 flex-none rounded-sm"
    />
    {{ option.data.name }}
  </VSelect>
</template>
