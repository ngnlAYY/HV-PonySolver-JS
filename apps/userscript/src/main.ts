import { App } from './app/app'

const app = new App()
const init = (): void => app.init()
const onPageHide = (event: PageTransitionEvent): void => {
  if (event.persisted) return
  // Readiness can arrive after teardown; do not revive the disposed App.
  document.removeEventListener('DOMContentLoaded', init)
  window.removeEventListener('pagehide', onPageHide)
  app.destroy()
}

window.addEventListener('pagehide', onPageHide)

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true })
} else {
  init()
}
