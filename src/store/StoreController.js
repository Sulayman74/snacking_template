import { store } from '../core/Store.js';

export class StoreController {
  constructor(host, eventName) {
    (this.host = host).addController(this);
    this.eventName = eventName;
    this._onStoreUpdate = () => this.host.requestUpdate();
  }

  hostConnected() {
    store.addEventListener(this.eventName, this._onStoreUpdate);
  }

  hostDisconnected() {
    store.removeEventListener(this.eventName, this._onStoreUpdate);
  }
}
