const {Emitter, TextEditor, TextBuffer} = require('atom')
const {Errors} = require('@atom/real-time-client')
const BufferBinding = require('./buffer-binding')
const EditorBinding = require('./editor-binding')
const EmptyPortalPaneItem = require('./empty-portal-pane-item')

module.exports =
class GuestPortalBinding {
  constructor ({client, portalId, workspace, notificationManager, didDispose}) {
    this.client = client
    this.portalId = portalId
    this.workspace = workspace
    this.notificationManager = notificationManager
    this.emitDidDispose = didDispose
    this.activePaneItem = null
    this.activeEditorBinding = null
    this.emptyPortalItem = new EmptyPortalPaneItem()
    this.editorBindingsByEditorProxy = new Map()
    this.bufferBindingsByBufferProxy = new Map()
    this.emitter = new Emitter()
  }

  async initialize () {
    try {
      this.portal = await this.client.joinPortal(this.portalId)
      if (!this.portal) return false

      this.portal.setDelegate(this)
      return true
    } catch (error) {
      this.didFailToJoin(error)
      return false
    }
  }

  dispose () {
    if (this.activePaneItemDestroySubscription) this.activePaneItemDestroySubscription.dispose()
    if (this.activePaneItem) this.activePaneItem.destroy()
    this.emptyPortalItem.destroy()
    this.emitDidDispose()
  }

  siteDidJoin (siteId) {
    const {login: hostLogin} = this.portal.getSiteIdentity(1)
    const {login: siteLogin} = this.portal.getSiteIdentity(siteId)
    this.notificationManager.addInfo(`@${siteLogin} has joined @${hostLogin}'s portal`)
    this.emitter.emit('did-change')
  }

  siteDidLeave (siteId) {
    const {login: hostLogin} = this.portal.getSiteIdentity(1)
    const {login: siteLogin} = this.portal.getSiteIdentity(siteId)
    this.notificationManager.addInfo(`@${siteLogin} has left @${hostLogin}'s portal`)
    this.emitter.emit('did-change')
  }

  async setActiveEditorProxy (editorProxy) {
    if (editorProxy == null) {
      await this.replaceActivePaneItem(this.emptyPortalItem)
    } else {
      const {bufferProxy} = editorProxy
      let editor
      let editorBinding = this.editorBindingsByEditorProxy.get(editorProxy)
      let bufferBinding = this.bufferBindingsByBufferProxy.get(bufferProxy)
      if (editorBinding) {
        editor = editorBinding.editor
      } else {
        let buffer
        if (bufferBinding) {
          buffer = bufferBinding.buffer
        } else {
          buffer = new TextBuffer()
          bufferBinding = new BufferBinding({
            buffer,
            didDispose: () => this.bufferBindingsByBufferProxy.delete(bufferProxy)
          })
          bufferBinding.setBufferProxy(bufferProxy)
          bufferProxy.setDelegate(bufferBinding)
          this.bufferBindingsByBufferProxy.set(bufferProxy, bufferBinding)
        }

        editor = new TextEditor({buffer, autoHeight: false})
        editorBinding = new EditorBinding({
          editor,
          isHost: false,
          didDispose: () => this.editorBindingsByEditorProxy.delete(editorProxy)
        })
        editorBinding.setEditorProxy(editorProxy)
        editorProxy.setDelegate(editorBinding)
        editor.setCursorBufferPosition([0, 0], {autoscroll: false})
        this.editorBindingsByEditorProxy.set(editorProxy, editorBinding)
      }
      this.activeEditorBinding = editorBinding
      await this.replaceActivePaneItem(editor)
      editorBinding.autoscrollToLastHostSelection()
    }
  }

  activate () {
    const activePaneItem = this.getActivePaneItem()
    const pane = this.workspace.paneForItem(activePaneItem)
    if (pane && activePaneItem) {
      pane.activateItem(activePaneItem)
      pane.activate()
    }
  }

  didFailToJoin (error) {
    let message, description
    if (error instanceof Errors.PortalNotFoundError) {
      message = 'Portal not found'
      description = 'No portal exists with that ID. Please ask your host to provide you with their current portal ID.'
    } else {
      message = 'Failed to join portal'
      description = `Attempting to join portal ${this.portalId} failed with error: <code>${error.message}</code>`
    }
    this.notificationManager.addError(message, {
      description,
      dismissable: true
    })
  }

  hostDidClosePortal () {
    this.notificationManager.addInfo('Portal closed', {
      description: 'Your host stopped sharing their editor.',
      dismissable: true
    })
    this.activePaneItem = null
  }

  hostDidLoseConnection () {
    this.notificationManager.addInfo('Portal closed', {
      description: (
        'We haven\'t heard from the host in a while.\n' +
        'Once your host is back online, they can share a new portal with you to resume collaborating.'
      ),
      dismissable: true
    })
    this.activePaneItem = null
  }

  leave () {
    this.portal.dispose()
  }

  toggleFollowHostCursorOnActiveEditorProxy () {
    const isFollowingHostCursor = this.activeEditorBinding.isFollowingHostCursor()
    this.activeEditorBinding.setFollowHostCursor(!isFollowingHostCursor)
  }

  async replaceActivePaneItem (newActivePaneItem) {
    this.newActivePaneItem = newActivePaneItem

    if (this.activePaneItem) {
      const pane = this.workspace.paneForItem(this.activePaneItem)
      const index = pane.getItems().indexOf(this.activePaneItem)
      pane.addItem(newActivePaneItem, {index})
      pane.removeItem(this.activePaneItem)
    } else {
      await this.workspace.open(newActivePaneItem)
    }

    this.activePaneItem = this.newActivePaneItem
    if (this.activePaneItemDestroySubscription) this.activePaneItemDestroySubscription.dispose()
    this.activePaneItemDestroySubscription = this.activePaneItem.onDidDestroy(this.leave.bind(this))
    this.newActivePaneItem = null
  }

  getActivePaneItem () {
    return this.newActivePaneItem ? this.newActivePaneItem : this.activePaneItem
  }

  onDidChange (callback) {
    return this.emitter.on('did-change', callback)
  }
}
