// Native parity port of web/src/components/data-display/SavedViewMenu.tsx.
// Replaces the DOM popover (document mousedown/Escape listeners), lucide icons,
// the shared web UI Button/Input/Modal/Badge/ConfirmDialog/EmptyState, the
// Tailwind classes, and the useAnnouncer hook with React Native Modals, glyph
// icon buttons, native design tokens, and the native a11y announcer -- while
// preserving saved-view state, API calls, the auto-apply-default behavior, and
// i18n intent.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useSetDefaultSavedView,
  useUpdateSavedView,
  type SavedView,
} from '../../api/hooks/useSavedViews';
import {announce} from '../a11y/AnnouncerRegion';

type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

/**
 * List-page affordance for "save this filter combo and recall it later".
 *
 * Renders THREE coordinated UI elements as one piece:
 *   1. A trigger button that opens the menu. The label collapses to the
 *      active view name when the current querystring exactly matches a
 *      saved view.
 *   2. The menu itself (a native modal anchored near the trigger): each row
 *      offers default / pin / rename / delete actions and a tap target that
 *      re-applies the view's querystring via `onApply`.
 *   3. A small badge (`{t('View')}: {name} x`) when a saved view is currently
 *      applied -- tapping the clear control resets the URL back to the
 *      unfiltered route.
 *
 * Behaviour notes:
 *   On mount, when the query has no value AND a default view exists for this
 *     route, the default is auto-applied exactly once. A ref guards against
 *     re-applying after the user clears it manually.
 *   The web closed the popover on outside click and on Escape; native maps
 *     that to the modal backdrop press and the hardware back affordance
 *     (onRequestClose), and the menu still closes after every successful
 *     action (pin / set-default / rename / delete).
 */
export interface SavedViewMenuProps {
  /** The route this menu manages views for (e.g. '/drives'). */
  route: string;
  /**
   * The current canonical querystring for the page (no leading '?').
   * Screens compute this from their filter state.
   */
  currentQuery: string;
  /**
   * Apply a saved view's querystring. The empty string clears the filters
   * back to the unfiltered route.
   */
  onApply: (query: string) => void;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
}

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

export function SavedViewMenu({
  route,
  currentQuery,
  onApply,
  className: _className,
}: SavedViewMenuProps) {
  const t = useNativeTranslationFallback();
  const {data: viewsRaw} = useSavedViews(route);
  const createMut = useCreateSavedView();
  const updateMut = useUpdateSavedView();
  const deleteMut = useDeleteSavedView();
  const setDefaultMut = useSetDefaultSavedView();

  const views = useMemo(() => viewsRaw ?? [], [viewsRaw]);
  const activeView = useMemo(
    () => views.find(v => v.query === currentQuery) ?? null,
    [views, currentQuery],
  );
  const defaultView = useMemo(
    () => views.find(v => v.is_default) ?? null,
    [views],
  );

  // -- Auto-apply default on first mount when the query has no value --
  // The ref guard ensures clearing the filters doesn't re-trigger the
  // auto-apply (which would fight the user's "clear filters" intent).
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (autoAppliedRef.current) {
      return;
    }
    if (!defaultView) {
      return;
    }
    if (currentQuery !== '') {
      // The query already has filters -- mark as "applied" so we never
      // overwrite the user's deep-link.
      autoAppliedRef.current = true;
      return;
    }
    autoAppliedRef.current = true;
    onApply(defaultView.query);
  }, [defaultView, currentQuery, onApply]);

  // -- Menu state -- (web used document mousedown/Escape listeners; native
  // relies on the modal backdrop press + onRequestClose for dismissal.)
  const [open, setOpen] = useState(false);

  // -- Save / rename / delete dialogs --
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedView | null>(null);

  // -- Handlers --
  const handleApply = (view: SavedView) => {
    onApply(view.query);
    setOpen(false);
    announce(
      t('savedViews.announceApplied', 'View {{name}} applied', {
        name: view.name,
      }),
    );
  };

  const handleClear = () => {
    onApply('');
    announce(t('savedViews.announceCleared', 'Saved view cleared'));
  };

  const handleTogglePin = (view: SavedView) => {
    updateMut.mutate({
      id: view.id,
      route: view.route,
      patch: {is_pinned: !view.is_pinned},
    });
  };

  const handleToggleDefault = (view: SavedView) => {
    setDefaultMut.mutate({
      id: view.id,
      route: view.route,
      isDefault: !view.is_default,
    });
  };

  const triggerLabel = activeView
    ? activeView.name
    : t('savedViews.title', 'Saved views');

  return (
    <View style={styles.root} testID="saved-view-menu">
      <Pressable
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={6}
        onPress={() => setOpen(value => !value)}
        style={({pressed}) => [
          styles.trigger,
          activeView ? styles.triggerActive : styles.triggerSecondary,
          pressed && styles.pressed,
        ]}
        testID="saved-view-menu-trigger">
        <AppText
          style={[
            styles.triggerGlyph,
            activeView ? styles.triggerGlyphActive : styles.triggerGlyphMuted,
          ]}
          variant="caption"
          weight="bold">
          {activeView ? 'BK' : 'B'}
        </AppText>
        <AppText
          numberOfLines={1}
          style={[
            styles.triggerLabel,
            activeView ? styles.triggerLabelActive : styles.triggerLabelMuted,
          ]}
          variant="caption"
          weight="semibold">
          {triggerLabel}
        </AppText>
      </Pressable>

      {activeView ? (
        <View style={styles.appliedBadge} testID="saved-view-applied-badge">
          <AppText
            style={styles.appliedBadgePrefix}
            variant="caption"
            weight="semibold">
            {`${t('savedViews.appliedBadge', 'View')}:`}
          </AppText>
          <AppText
            numberOfLines={1}
            style={styles.appliedBadgeName}
            variant="caption"
            weight="semibold">
            {activeView.name}
          </AppText>
          <Pressable
            accessibilityLabel={t('savedViews.clearApplied', 'Clear applied view')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleClear}
            style={({pressed}) => [
              styles.appliedBadgeClear,
              pressed && styles.pressed,
            ]}
            testID="saved-view-applied-clear">
            <AppText
              style={styles.appliedBadgeClearGlyph}
              variant="caption"
              weight="bold">
              x
            </AppText>
          </Pressable>
        </View>
      ) : null}

      <SavedViewMenuModal
        currentQuery={currentQuery}
        onApply={handleApply}
        onClose={() => setOpen(false)}
        onDelete={view => {
          setDeleteTarget(view);
          setOpen(false);
        }}
        onManage={() => {
          setOpen(false);
          setManageOpen(true);
        }}
        onRename={view => {
          setRenameTarget(view);
          setOpen(false);
        }}
        onSave={() => {
          setOpen(false);
          setSaveOpen(true);
        }}
        onToggleDefault={handleToggleDefault}
        onTogglePin={handleTogglePin}
        open={open}
        t={t}
        views={views}
      />

      <SavedViewSaveDialog
        onClose={() => setSaveOpen(false)}
        onSave={(name, makeDefault) => {
          createMut.mutate(
            {
              name,
              route,
              query: currentQuery,
              is_default: makeDefault,
            },
            {
              onSuccess: () => setSaveOpen(false),
            },
          );
        }}
        open={saveOpen}
        saving={createMut.isPending}
        t={t}
      />

      <SavedViewRenameDialog
        onClose={() => setRenameTarget(null)}
        onRename={(view, name) => {
          updateMut.mutate(
            {id: view.id, route: view.route, patch: {name}},
            {onSuccess: () => setRenameTarget(null)},
          );
        }}
        saving={updateMut.isPending}
        t={t}
        view={renameTarget}
      />

      <SavedViewDeleteDialog
        loading={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) {
            return;
          }
          deleteMut.mutate(
            {id: deleteTarget.id, route: deleteTarget.route},
            {onSuccess: () => setDeleteTarget(null)},
          );
        }}
        t={t}
        view={deleteTarget}
      />

      <SavedViewManageDialog
        currentQuery={currentQuery}
        onApply={view => {
          handleApply(view);
          setManageOpen(false);
        }}
        onClose={() => setManageOpen(false)}
        onDelete={view => setDeleteTarget(view)}
        onRename={view => setRenameTarget(view)}
        onToggleDefault={handleToggleDefault}
        onTogglePin={handleTogglePin}
        open={manageOpen}
        t={t}
        views={views}
      />
    </View>
  );
}

SavedViewMenu.displayName = 'SavedViewMenu';

// -- Menu (popover replacement) ---------------------------------------------

interface SavedViewMenuModalProps {
  open: boolean;
  views: SavedView[];
  currentQuery: string;
  t: NativeTFunction;
  onClose: () => void;
  onApply: (view: SavedView) => void;
  onToggleDefault: (view: SavedView) => void;
  onTogglePin: (view: SavedView) => void;
  onRename: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
  onManage: () => void;
  onSave: () => void;
}

function SavedViewMenuModal({
  open,
  views,
  currentQuery,
  t,
  onClose,
  onApply,
  onToggleDefault,
  onTogglePin,
  onRename,
  onDelete,
  onManage,
  onSave,
}: SavedViewMenuModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.menuOverlay}>
        <Pressable
          accessibilityLabel={t('savedViews.title', 'Saved views')}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          accessibilityLabel={t('savedViews.title', 'Saved views')}
          accessibilityRole="menu"
          style={styles.menu}
          testID="saved-view-menu-items">
          <View style={styles.menuHeader}>
            <AppText style={styles.menuHeaderTitle} variant="caption" weight="semibold">
              {t('savedViews.title', 'Saved views')}
            </AppText>
            {views.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={onManage}
                style={({pressed}) => [pressed && styles.pressed]}
                testID="saved-view-menu-manage">
                <AppText
                  style={styles.menuHeaderLink}
                  variant="caption"
                  weight="semibold">
                  {t('savedViews.manage', 'Manage views')}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {views.length === 0 ? (
            <View style={styles.menuEmpty} testID="saved-view-menu-empty">
              <AppText style={styles.menuEmptyText} tone="muted">
                {t('savedViews.empty', 'No saved views yet')}
              </AppText>
              <DialogButton
                label={t('savedViews.saveCurrent', 'Save current view…')}
                onPress={onSave}
                testID="saved-view-menu-empty-save"
                variant="primary"
              />
            </View>
          ) : (
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              style={styles.menuList}>
              {views.map(v => (
                <SavedViewMenuRow
                  isActive={v.query === currentQuery}
                  key={v.id}
                  onApply={() => onApply(v)}
                  onDelete={() => onDelete(v)}
                  onRename={() => onRename(v)}
                  onToggleDefault={() => onToggleDefault(v)}
                  onTogglePin={() => onTogglePin(v)}
                  t={t}
                  view={v}
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.menuFooter}>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={onSave}
              style={({pressed}) => [
                styles.menuFooterAction,
                pressed && styles.pressed,
              ]}
              testID="saved-view-menu-save">
              <AppText
                style={styles.menuFooterGlyph}
                variant="caption"
                weight="bold">
                +
              </AppText>
              <AppText
                style={styles.menuFooterLabel}
                variant="caption"
                weight="semibold">
                {t('savedViews.saveCurrent', 'Save current view…')}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface SavedViewMenuRowProps {
  view: SavedView;
  isActive: boolean;
  t: NativeTFunction;
  onApply: () => void;
  onToggleDefault: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function SavedViewMenuRow({
  view,
  isActive,
  t,
  onApply,
  onToggleDefault,
  onTogglePin,
  onRename,
  onDelete,
}: SavedViewMenuRowProps) {
  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        accessibilityLabel={view.name}
        accessibilityRole="button"
        accessibilityState={{selected: isActive}}
        onPress={onApply}
        style={({pressed}) => [styles.rowLabelButton, pressed && styles.pressed]}>
        <AppText
          numberOfLines={1}
          style={[
            styles.rowLabel,
            isActive ? styles.rowLabelActive : styles.rowLabelInactive,
          ]}>
          {view.is_default ? (
            <AppText style={styles.inlineStar} weight="bold">
              {'* '}
            </AppText>
          ) : null}
          {view.name}
        </AppText>
      </Pressable>
      <IconActionButton
        glyph="*"
        label={
          view.is_default
            ? t('savedViews.unsetDefault', 'Clear default')
            : t('savedViews.setDefault', 'Set as default')
        }
        onPress={onToggleDefault}
        tone={view.is_default ? 'amber' : 'muted'}
      />
      <IconActionButton
        glyph="PIN"
        label={
          view.is_pinned
            ? t('savedViews.unpin', 'Unpin')
            : t('savedViews.pin', 'Pin')
        }
        onPress={onTogglePin}
        tone={view.is_pinned ? 'accent' : 'muted'}
      />
      <IconActionButton
        glyph="ED"
        label={t('savedViews.renamePrompt', 'Rename view')}
        onPress={onRename}
        tone="muted"
      />
      <IconActionButton
        glyph="DL"
        label={t('common.delete', 'Delete')}
        onPress={onDelete}
        tone="danger"
      />
    </View>
  );
}

type IconButtonTone = 'accent' | 'amber' | 'danger' | 'muted';

interface IconActionButtonProps {
  glyph: string;
  label: string;
  onPress: () => void;
  tone: IconButtonTone;
}

function IconActionButton({glyph, label, onPress, tone}: IconActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.iconButton, pressed && styles.iconButtonPressed]}>
      <AppText
        style={[styles.iconGlyph, iconToneStyles[tone]]}
        variant="caption"
        weight="bold">
        {glyph}
      </AppText>
    </Pressable>
  );
}

// -- Save dialog ------------------------------------------------------------

interface SavedViewSaveDialogProps {
  open: boolean;
  saving: boolean;
  t: NativeTFunction;
  onClose: () => void;
  onSave: (name: string, makeDefault: boolean) => void;
}

function SavedViewSaveDialog({
  open,
  saving,
  t,
  onClose,
  onSave,
}: SavedViewSaveDialogProps) {
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);

  // Reset on open so a previous abort doesn't leak state into the next
  // save flow.
  useEffect(() => {
    if (open) {
      setName('');
      setMakeDefault(false);
    }
  }, [open]);

  const trimmed = name.trim();
  const handleSubmit = () => {
    if (!trimmed) {
      return;
    }
    onSave(trimmed, makeDefault);
  };

  return (
    <DialogShell
      onClose={onClose}
      testID="saved-view-save-dialog"
      title={t('savedViews.saveCurrent', 'Save current view…')}
      visible={open}>
      <DialogField
        autoFocus
        label={t('savedViews.name', 'Name')}
        maxLength={80}
        onChangeText={setName}
        placeholder={t('savedViews.namePlaceholder', 'View name')}
        value={name}
      />
      <CheckRow
        checked={makeDefault}
        label={t(
          'savedViews.makeDefault',
          'Apply automatically when I open this page',
        )}
        onToggle={() => setMakeDefault(value => !value)}
      />
      <View style={styles.dialogActions}>
        <DialogButton
          label={t('common.cancel', 'Cancel')}
          onPress={onClose}
          testID="saved-view-save-cancel"
          variant="ghost"
        />
        <DialogButton
          disabled={!trimmed || saving}
          label={saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          onPress={handleSubmit}
          testID="saved-view-save-confirm"
          variant="primary"
        />
      </View>
    </DialogShell>
  );
}

// -- Rename dialog ----------------------------------------------------------

interface SavedViewRenameDialogProps {
  view: SavedView | null;
  saving: boolean;
  t: NativeTFunction;
  onClose: () => void;
  onRename: (view: SavedView, name: string) => void;
}

function SavedViewRenameDialog({
  view,
  saving,
  t,
  onClose,
  onRename,
}: SavedViewRenameDialogProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (view) {
      setName(view.name);
    }
  }, [view]);

  const trimmed = name.trim();
  const handleSubmit = () => {
    if (!view || !trimmed || trimmed === view.name) {
      onClose();
      return;
    }
    onRename(view, trimmed);
  };

  return (
    <DialogShell
      onClose={onClose}
      testID="saved-view-rename-dialog"
      title={t('savedViews.renamePrompt', 'Rename view')}
      visible={view != null}>
      <DialogField
        autoFocus
        label={t('savedViews.name', 'Name')}
        maxLength={80}
        onChangeText={setName}
        placeholder={t('savedViews.namePlaceholder', 'View name')}
        value={name}
      />
      <View style={styles.dialogActions}>
        <DialogButton
          label={t('common.cancel', 'Cancel')}
          onPress={onClose}
          testID="saved-view-rename-cancel"
          variant="ghost"
        />
        <DialogButton
          disabled={!trimmed || saving}
          label={saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
          onPress={handleSubmit}
          testID="saved-view-rename-confirm"
          variant="primary"
        />
      </View>
    </DialogShell>
  );
}

// -- Delete confirm dialog --------------------------------------------------

interface SavedViewDeleteDialogProps {
  view: SavedView | null;
  loading: boolean;
  t: NativeTFunction;
  onCancel: () => void;
  onConfirm: () => void;
}

function SavedViewDeleteDialog({
  view,
  loading,
  t,
  onCancel,
  onConfirm,
}: SavedViewDeleteDialogProps) {
  return (
    <DialogShell
      onClose={onCancel}
      testID="saved-view-delete-dialog"
      title={t('savedViews.deleteTitle', 'Delete saved view')}
      visible={view != null}>
      <AppText style={styles.dialogMessage} tone="secondary">
        {t('savedViews.deleteConfirm', 'Delete saved view "{{name}}"?', {
          name: view?.name ?? '',
        })}
      </AppText>
      <View style={styles.dialogActions}>
        <DialogButton
          label={t('common.cancel', 'Cancel')}
          onPress={onCancel}
          testID="saved-view-delete-cancel"
          variant="ghost"
        />
        <DialogButton
          label={t('common.delete', 'Delete')}
          loading={loading}
          onPress={onConfirm}
          testID="saved-view-delete-confirm"
          variant="danger"
        />
      </View>
    </DialogShell>
  );
}

// -- Manage dialog ----------------------------------------------------------

interface SavedViewManageDialogProps {
  open: boolean;
  views: SavedView[];
  currentQuery: string;
  t: NativeTFunction;
  onClose: () => void;
  onApply: (view: SavedView) => void;
  onTogglePin: (view: SavedView) => void;
  onToggleDefault: (view: SavedView) => void;
  onRename: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
}

function SavedViewManageDialog({
  open,
  views,
  currentQuery,
  t,
  onClose,
  onApply,
  onTogglePin,
  onToggleDefault,
  onRename,
  onDelete,
}: SavedViewManageDialogProps) {
  return (
    <DialogShell
      onClose={onClose}
      testID="saved-view-manage-dialog"
      title={t('savedViews.manage', 'Manage views')}
      visible={open}>
      {views.length === 0 ? (
        <View style={styles.menuEmpty}>
          <AppText style={styles.menuEmptyText} tone="muted">
            {t('savedViews.empty', 'No saved views yet')}
          </AppText>
        </View>
      ) : (
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          style={styles.manageList}>
          {views.map(v => {
            const isActive = v.query === currentQuery;
            return (
              <View
                key={v.id}
                style={[styles.manageRow, isActive && styles.manageRowActive]}>
                <Pressable
                  accessibilityLabel={
                    v.query || t('savedViews.emptyQuery', 'No filters')
                  }
                  accessibilityRole="button"
                  onPress={() => onApply(v)}
                  style={({pressed}) => [
                    styles.rowLabelButton,
                    pressed && styles.pressed,
                  ]}>
                  <AppText
                    numberOfLines={1}
                    style={styles.manageRowLabel}
                    weight="semibold">
                    {v.is_default ? (
                      <AppText style={styles.inlineStar} weight="bold">
                        {'* '}
                      </AppText>
                    ) : null}
                    {v.name}
                  </AppText>
                </Pressable>
                <IconActionButton
                  glyph="*"
                  label={
                    v.is_default
                      ? t('savedViews.unsetDefault', 'Clear default')
                      : t('savedViews.setDefault', 'Set as default')
                  }
                  onPress={() => onToggleDefault(v)}
                  tone={v.is_default ? 'amber' : 'muted'}
                />
                <IconActionButton
                  glyph="PIN"
                  label={
                    v.is_pinned
                      ? t('savedViews.unpin', 'Unpin')
                      : t('savedViews.pin', 'Pin')
                  }
                  onPress={() => onTogglePin(v)}
                  tone={v.is_pinned ? 'accent' : 'muted'}
                />
                <IconActionButton
                  glyph="ED"
                  label={t('savedViews.renamePrompt', 'Rename view')}
                  onPress={() => onRename(v)}
                  tone="muted"
                />
                <IconActionButton
                  glyph="DL"
                  label={t('common.delete', 'Delete')}
                  onPress={() => onDelete(v)}
                  tone="danger"
                />
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.dialogActionsEnd}>
        <DialogButton
          label={t('common.close', 'Close')}
          onPress={onClose}
          testID="saved-view-manage-close"
          variant="secondary"
        />
      </View>
    </DialogShell>
  );
}

// -- Shared dialog primitives -----------------------------------------------

interface DialogShellProps {
  visible: boolean;
  title: string;
  testID: string;
  onClose: () => void;
  children: ReactNode;
}

function DialogShell({visible, title, testID, onClose, children}: DialogShellProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.dialogOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.dialog} testID={testID}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.dialogBody}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface DialogFieldProps {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  autoFocus?: boolean;
  onChangeText: (value: string) => void;
}

function DialogField({
  label,
  value,
  placeholder,
  maxLength,
  autoFocus = false,
  onChangeText,
}: DialogFieldProps) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="sentences"
        autoFocus={autoFocus}
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

interface CheckRowProps {
  checked: boolean;
  label: string;
  onToggle: () => void;
}

function CheckRow({checked, label, onToggle}: CheckRowProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      onPress={onToggle}
      style={({pressed}) => [styles.checkRow, pressed && styles.pressed]}>
      <View
        pointerEvents="none"
        style={[styles.checkBox, checked && styles.checkBoxChecked]}>
        {checked ? (
          <AppText style={styles.checkGlyph} variant="caption" weight="bold">
            x
          </AppText>
        ) : null}
      </View>
      <AppText style={styles.checkLabel} tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

type DialogButtonVariant = 'danger' | 'ghost' | 'primary' | 'secondary';

interface DialogButtonProps {
  label: string;
  onPress: () => void;
  variant: DialogButtonVariant;
  testID: string;
  disabled?: boolean;
  loading?: boolean;
}

function DialogButton({
  label,
  onPress,
  variant,
  testID,
  disabled = false,
  loading = false,
}: DialogButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        dialogButtonVariantStyles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.background : colors.accent}
          size="small"
        />
      ) : (
        <AppText
          style={[styles.buttonText, dialogButtonTextStyles[variant]]}
          weight="semibold">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  appliedBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  appliedBadgeClear: {
    alignItems: 'center',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  appliedBadgeClearGlyph: {
    color: colors.textMuted,
  },
  appliedBadgeName: {
    color: colors.accent,
    flexShrink: 1,
    maxWidth: 180,
  },
  appliedBadgePrefix: {
    color: colors.textSecondary,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    textAlign: 'center',
  },
  checkBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkBoxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkGlyph: {
    color: colors.accent,
    fontSize: 11,
    lineHeight: 14,
  },
  checkLabel: {
    flex: 1,
    minWidth: 0,
  },
  checkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '86%',
    maxWidth: 520,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  dialogActionsEnd: {
    alignItems: 'flex-end',
    paddingTop: spacing.sm,
  },
  dialogBody: {
    gap: spacing.md,
  },
  dialogMessage: {
    lineHeight: 22,
  },
  dialogOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  disabled: {
    opacity: 0.48,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    minWidth: 30,
    paddingHorizontal: 4,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
    opacity: 0.9,
  },
  iconGlyph: {
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  inlineStar: {
    color: colors.warning,
  },
  input: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  manageList: {
    maxHeight: 360,
  },
  manageRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  manageRowActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  manageRowLabel: {
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
  },
  menu: {
    ...shadows.panel,
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.sm,
    marginRight: spacing.lg,
    marginTop: spacing.xxl,
    maxWidth: 320,
    minWidth: 264,
    padding: spacing.sm,
  },
  menuEmpty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  menuEmptyText: {
    textAlign: 'center',
  },
  menuFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  menuFooterAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },
  menuFooterGlyph: {
    color: colors.accent,
  },
  menuFooterLabel: {
    color: colors.accent,
  },
  menuHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  menuHeaderLink: {
    color: colors.accent,
  },
  menuHeaderTitle: {
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  menuList: {
    maxHeight: 320,
  },
  menuOverlay: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rowActive: {
    backgroundColor: colors.surfaceRaised,
  },
  rowLabel: {
    fontSize: typography.body,
  },
  rowLabelActive: {
    color: colors.textPrimary,
  },
  rowLabelButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
  },
  rowLabelInactive: {
    color: colors.textSecondary,
  },
  trigger: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 240,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  triggerActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  triggerGlyph: {
    letterSpacing: 0.4,
  },
  triggerGlyphActive: {
    color: colors.accent,
  },
  triggerGlyphMuted: {
    color: colors.textSecondary,
  },
  triggerLabel: {
    flexShrink: 1,
    maxWidth: 180,
  },
  triggerLabelActive: {
    color: colors.accent,
  },
  triggerLabelMuted: {
    color: colors.textPrimary,
  },
  triggerSecondary: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
  },
});

const iconToneStyles = StyleSheet.create<Record<IconButtonTone, TextStyle>>({
  accent: {
    color: colors.accent,
  },
  amber: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  muted: {
    color: colors.textMuted,
  },
});

const dialogButtonVariantStyles = StyleSheet.create<
  Record<DialogButtonVariant, ViewStyle>
>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 1,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
});

const dialogButtonTextStyles = StyleSheet.create<
  Record<DialogButtonVariant, TextStyle>
>({
  danger: {
    color: colors.danger,
  },
  ghost: {
    color: colors.textSecondary,
  },
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.textPrimary,
  },
});
