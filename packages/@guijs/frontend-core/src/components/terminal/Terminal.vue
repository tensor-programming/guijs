<script>
import { ref, onMounted, watch, onUnmounted, onActivated, computed } from '@vue/composition-api'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from '../../util/xterm-addon-web-links/lib/xterm-addon-web-links'
import { WebglAddon } from 'xterm-addon-webgl'
import { onWindowEvent } from '@guijs/frontend-ui/util/window'
import { useMutation } from '@vue/apollo-composable'
import { pushScope, popScope } from '@/util/keybinding'
import { useSetting } from '@/util/setting'
import gql from 'graphql-tag'

const isWindows = ['Windows', 'Win16', 'Win32', 'WinCE'].includes(navigator.platform)

const isWebgl2Supported = (() => {
  let isSupported = window.WebGL2RenderingContext ? undefined : false
  return () => {
    if (isSupported === undefined) {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2', { depth: false, antialias: false })
      isSupported = gl instanceof window.WebGL2RenderingContext
    }
    return isSupported
  }
})()

const terminalCache = {}

const defaultTheme = {
  foreground: '#2c3e50',
  background: '#fff',
  cursor: '#ccc',
  cursorAccent: '#ddd',
  selection: '#ccc',
  black: '#000000',
  red: '#e83030',
  brightRed: '#e83030',
  green: '#42b983',
  brightGreen: '#42b983',
  brightYellow: '#ea6e00',
  yellow: '#ea6e00',
  magenta: '#e83030',
  brightMagenta: '#e83030',
  cyan: '#03c2e6',
  brightBlue: '#03c2e6',
  brightCyan: '#03c2e6',
  blue: '#03c2e6',
  white: '#d0d0d0',
  brightBlack: '#808080',
  brightWhite: '#ffffff',
}

const darkTheme = {
  ...defaultTheme,
  foreground: '#fff',
  background: '#212935',
  cursor: '#A0AEC0',
  selection: '#4A5568',
  magenta: '#e83030',
  brightMagenta: '#e83030',
}

export default {
  props: {
    terminalId: {
      type: String,
      required: true,
    },

    cwd: {
      type: String,
      default: null,
    },
  },

  setup (props) {
    // Cache
    let cached = terminalCache[props.terminalId]
    if (!cached) {
      cached = terminalCache[props.terminalId] = {
        ws: null,
        attached: false,
        term: null,
        listeners: [],
        fitAddon: new FitAddon(),
        searchAddon: new SearchAddon(),
        scroll: 0,
        targetEl: null,
        ready: false,
      }
    }

    let listeners = cached.listeners
    let disposableListeners = []

    // Web socket

    /** @type {WebSocket} */
    let ws = cached.ws

    let sendQueue = []

    function send (type, data) {
      if (ws.readyState === ws.OPEN) {
        ws.send(`${type}:${typeof data === 'string' ? data : JSON.stringify(data)}`)
      } else {
        sendQueue.push({ type, data })
      }
    }

    function on (type, handler) {
      const listener = event => {
        if (typeof event.data === 'string') {
          const separatorIndex = event.data.indexOf(':')
          const messageType = event.data.substr(0, separatorIndex)
          const rawData = event.data.substr(separatorIndex + 1)
          if (messageType === type) {
            handler(rawData)
          }
        }
      }
      ws.addEventListener('message', listener)
      return () => {
        ws.removeEventListener('message', listener)
      }
    }

    const attached = ref(cached.attached)

    if (!ws) {
      // @TODO better endpoint handling (dynamic ports)
      ws = cached.ws = new WebSocket(process.env.VUE_APP_TERMINAL_WS_URL)

      // Attach to terminal

      listeners.push(on('terminal-attached', () => {
        attached.value = true
      }))

      const onOpen = () => {
        send('terminal-attach', { id: props.terminalId })
        for (const { type, data } of sendQueue) {
          send(type, data)
        }
        sendQueue = []
      }
      ws.addEventListener('open', onOpen)
      listeners.push(() => ws.removeEventListener('open', onOpen))
    }

    // Change title
    const { mutate: changeTitle } = useMutation(gql`
      mutation changeTerminalTitle ($input: ChangeTerminalTitleInput!) {
        changeTerminalTitle (input: $input) {
          id
          title
        }
      }
    `)

    // Theme
    const { setting: darkMode } = useSetting('dark-mode')

    const currentTheme = computed(() => {
      if (darkMode.value) {
        return darkTheme
      }
      return defaultTheme
    })

    watch(currentTheme, value => {
      if (term) {
        term.setOption('theme', value)
      }
    })

    // XTerminal

    const fitAddon = cached.fitAddon
    const searchAddon = cached.searchAddon

    /** @type {Terminal} */
    let term = cached.term

    const el = ref(null)
    const xtermTarget = ref(null)

    function createTerminal () {
      if (!term) {
        term = new Terminal({
          theme: currentTheme.value,
          scrollback: 4000,
          windowsMode: isWindows,
          macOptionIsMeta: true,
          fontSize: 14,
        })
        cached.term = term

        // Addons

        term.loadAddon(fitAddon)
        term.loadAddon(searchAddon)
        term.loadAddon(new WebLinksAddon())

        term.open(cached.targetEl)

        if (isWebgl2Supported()) {
          term.loadAddon(new WebglAddon())
        }

        // Data

        listeners.push(on('terminal-data-out', data => {
          term.write(data)
        }))

        listeners.push(term.onData(data => {
          write(data)
        }))

        // Resize
        listeners.push(term.onResize(({ cols, rows }) => {
          onResize(cols, rows)
        }))

        // Scroll
        listeners.push(term.onScroll(position => {
          cached.scroll = position
        }))

        // Focus
        const onFocus = () => {
          pushScope('terminals')
          pushScope('terminals.terminal')
        }
        const onBlur = () => {
          popScope('terminals.terminal')
          popScope('terminals')
        }
        term.textarea.addEventListener('focus', onFocus)
        term.textarea.addEventListener('blur', onBlur)
        listeners.push(() => {
          term.textarea.removeEventListener('focus', onFocus)
          term.textarea.removeEventListener('blur', onBlur)
          onBlur()
        })

        // Title
        disposableListeners.push(term.onTitleChange(async title => {
          await changeTitle({
            input: {
              id: props.terminalId,
              title,
            },
          })
        }))
      }

      // Init
      fitAddon.fit()
      term.focus()
      // Initial size is undefined on the server

      term.setOption('cursorBlink', true)
      term.setOption('theme', currentTheme.value)

      // https://github.com/xtermjs/xterm.js/issues/291
      // term.scrollToLine(cached.scroll)
      term._core._onScroll.fire(cached.scroll)

      mayBeReady()
    }

    onMounted(() => {
      // Re-use the same DOM element
      if (cached.targetEl) {
        while (el.value.firstChild) {
          el.value.removeChild(el.value.firstChild)
        }
        el.value.appendChild(cached.targetEl)
      } else {
        cached.targetEl = xtermTarget.value
      }

      createTerminal()
    })

    onActivated(() => {
      createTerminal()
    })

    watch(attached, value => {
      cached.attached = value
      if (value) {
        mayBeReady()
      }
    })

    function mayBeReady () {
      if (term && attached.value && !cached.ready) {
        onTerminalReady()
      }
    }

    function onTerminalReady () {
      onResize(term.cols, term.rows)
      send('terminal-ready', '')
      cached.ready = true
    }

    onUnmounted(() => {
      for (const off of disposableListeners) {
        off.dispose ? off.dispose() : off()
      }
      disposableListeners = []
    })

    function onResize (columns, rows) {
      send('terminal-resize', { columns, rows })
    }

    // Terminal utils

    function write (data) {
      if (!attached.value) return
      send('terminal-data-in', data)
    }

    function clear () {
      term.clear()
    }

    function destroy () {
      for (const off of listeners) {
        off.dispose ? off.dispose() : off()
      }
      listeners = []
      term.dispose()
      term = null
      delete terminalCache[props.terminalId]
    }

    listeners.push(on('terminal-destroyed', destroy))

    // Paste
    onWindowEvent('paste', event => {
      if (term) {
        const data = (event.clipboardData || window.clipboardData).getData('text')
        event.preventDefault()
        event.stopPropagation()
        write(data)
      }
    }, {
      capture: true,
    })

    // Element resize
    function onElResize () {
      if (term) {
        fitAddon.fit()
      }
    }

    return {
      el,
      xtermTarget,
      clear,
      onElResize,
    }
  },
}
</script>

<template>
  <div
    ref="el"
    class="relative p-2 overflow-hidden"
  >
    <div
      ref="xtermTarget"
      class="w-full h-full"
    />

    <resize-observer @notify="onElResize()" />
  </div>
</template>

<style lang="postcss">
@import "~xterm/css/xterm.css";
</style>
