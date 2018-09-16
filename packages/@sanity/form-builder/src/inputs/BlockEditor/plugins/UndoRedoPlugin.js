// @flow
import Hotkeys from 'slate-hotkeys'
import type {Type, UndoRedoStack, SlateChange} from '../typeDefs'
import patchesToChange from '../utils/patchesToChange'

type Options = {
  stack: UndoRedoStack,
  onChange: SlateChange => SlateChange,
  blockContentType: Type,
  sendPatchesFromChange: void => void
}

// This plugin handles our own undo redo (disables Slate built in handling)

export default function UndoRedoPlugin(options: Options) {
  const {stack, blockContentType, onChange, sendPatchesFromChange} = options
  return {
    // eslint-disable-next-line complexity
    onKeyDown(event: SyntheticKeyboardEvent<*>, change: SlateChange) {
      if (Hotkeys.isUndo(event) || Hotkeys.isRedo(event)) {
        // Make sure we have sent every pending patch first
        if (sendPatchesFromChange) {
          sendPatchesFromChange()
        }
        let item
        // Undo
        if (Hotkeys.isUndo(event) && (item = stack.undo.pop())) {
          const {patches, editorValue} = item
          // Create Slate change for these patches
          const patchChange = patchesToChange(patches, editorValue, null, blockContentType)
          // Keep track of the original operations, and create a reversed change
          const originalOperationIndex = patchChange.operations.size
          patchChange.undo()
          // Remove the original non-undo operations
          patchChange.operations = patchChange.operations.splice(0, originalOperationIndex)
          // Restore the selection
          patchChange.select(editorValue.selection).focus()
          // Tag the change, so that changeToPatches know's it's a undoRedo change.
          patchChange.__isUndoRedo = 'undo'
          stack.redo.push(item)
          onChange(patchChange)
        }
        // Redo (pretty much as undo, just that we don't need to reverse any operations)
        if (Hotkeys.isRedo(event) && (item = stack.redo.pop())) {
          const {patches, editorValue, select} = item
          const patchChange = patchesToChange(patches, editorValue, null, blockContentType)
          // Restore the selection
          patchChange.applyOperations([select]).focus()
          patchChange.__isUndoRedo = 'redo'
          stack.undo.push(item)
          onChange(patchChange)
        }
        return change
      }
      return undefined
    }
  }
}
