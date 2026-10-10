import { AlertMessageEditor } from '../AlertMessageEditor'
import { parseOptionalNumber } from './inputValues'
import { valueKindForState } from './signalCatalog'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function MessageFields({ controller }: { controller: AlertRuleEditorController }) {
  const { editor, setEditor, previewVehicleName, previewVehicle } = controller
  return (
    <div className="sm:col-span-2">
      <AlertMessageEditor
        msgTemplate={editor.msg_template}
        includeTitle={editor.include_title}
        draft={{
          name: editor.name,
          kind: editor.kind,
          component_name: editor.kind === 'system_component' ? editor.component_name : null,
          place_id: editor.kind === 'place' ? parseOptionalNumber(editor.place_id) : null,
          transition: editor.kind === 'system_component' || editor.kind === 'place' ? editor.transition : null,
          signal_name: editor.signal_name,
          op: editor.op,
          severity: editor.severity,
          vehicle_name: previewVehicleName,
          vehicle_timezone: previewVehicle?.timezone,
          value_num: valueKindForState(editor) === 'number' ? parseOptionalNumber(editor.value_num) : null,
          value_text: valueKindForState(editor) === 'text' ? editor.value_text : null,
          value_bool: valueKindForState(editor) === 'bool' ? editor.value_bool : null,
          value_min: valueKindForState(editor) === 'range' ? parseOptionalNumber(editor.value_min) : null,
          value_max: valueKindForState(editor) === 'range' ? parseOptionalNumber(editor.value_max) : null,
          metric_id: editor.metric_id || null,
          metric_window: editor.metric_window || null,
          metric_op: editor.metric_op,
          metric_threshold: parseOptionalNumber(editor.metric_threshold),
        }}
        onTemplateChange={next => setEditor(s => ({ ...s, msg_template: next }))}
        onIncludeTitleChange={next => setEditor(s => ({ ...s, include_title: next }))}
      />
    </div>
  )
}
