import { App as CoreApp, type AppDependencies } from '@hv-pony-solver/browser-core'

import { createAppDependencies } from './app-dependencies'

export class App extends CoreApp {
  constructor(dependencies?: AppDependencies) {
    const appOwner: { getSignal?: () => AbortSignal | undefined; recoverCredentials?: () => void } = {}
    super(
      dependencies ??
        createAppDependencies(
          () => appOwner.getSignal?.(),
          () => appOwner.recoverCredentials?.(),
        ),
    )
    appOwner.getSignal = () => this.getAbortSignal()
    appOwner.recoverCredentials = () => this.recoverAfterModelCredentialsChanged()
  }
}
