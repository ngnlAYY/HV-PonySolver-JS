import { App as CoreApp, type AppDependencies } from '@hv-pony-solver/browser-core'

import { createAppDependencies } from './app-dependencies'

export class App extends CoreApp {
  constructor(dependencies?: AppDependencies) {
    const signalOwner: { get?: () => AbortSignal | undefined } = {}
    super(dependencies ?? createAppDependencies(() => signalOwner.get?.()))
    signalOwner.get = () => this.getAbortSignal()
  }
}
