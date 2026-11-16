import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useAuthStore, useConfigStore } from '@/stores';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { apiClient } from '@/services/api/client';
import {
  routingProfilesApi,
  type RoutingProfiles,
  type RoutingProfile,
  type RoutingAuthOverride,
} from '@/services/api/routingProfiles';
import type { AuthFileItem } from '@/types/authFile';
import styles from './RoutingProfilesCard.module.scss';

const lines = (value: string) => value.split('\n');

export function RoutingProfilesCard(props: { files: AuthFileItem[]; disabled: boolean; displayNameFor: (name: string) => string }) {
  const apiBase = useAuthStore((state) => state.apiBase);
  return <ProfileEditor key={apiBase} {...props} />;
}

function ProfileEditor({ files, disabled, displayNameFor }: { files: AuthFileItem[]; disabled: boolean; displayNameFor: (name: string) => string }) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<RoutingProfiles>({});
  const [saved, setSaved] = useState('{}');
  const [selected, setSelected] = useState('default');
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let active = true;
    const revision = apiClient.getConnectionRevision();
    routingProfilesApi
      .list()
      .then((value) => {
        if (!active || revision !== apiClient.getConnectionRevision()) return;
        setProfiles(value);
        setSaved(JSON.stringify(value));
        setLoaded(true);
        setError('');
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [reload]);
  const profile = profiles[selected] ?? {};
  const master = profiles.default ?? {};
  const locked = disabled || !loaded || saving;
  const dirty = JSON.stringify(profiles) !== saved;
  useUnsavedChangesGuard({
    shouldBlock: dirty,
    dialog: {
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    },
  });
  const update = (patch: Partial<RoutingProfile>) =>
    setProfiles((current) => ({ ...current, [selected]: { ...current[selected], ...patch } }));
  const updateAuth = (id: string, patch: Partial<RoutingAuthOverride>) =>
    update({ auths: { ...profile.auths, [id]: { ...profile.auths?.[id], ...patch } } });
  const ids = [
    ...new Set([
      ...files.map((file) => file.name),
      ...Object.keys(master.auths ?? {}),
      ...Object.keys(profile.auths ?? {}),
      ...(profile.allowedAuths ?? []),
      ...(master.allowedAuths ?? []),
    ]),
  ];
  const save = async () => {
    const revision = apiClient.getConnectionRevision();
    const snapshot = profiles;
    setSaving(true);
    setError('');
    try {
      await routingProfilesApi.replace(snapshot);
      if (!alive.current || revision !== apiClient.getConnectionRevision()) return;
      setSaved(JSON.stringify(snapshot));
      useConfigStore.getState().clearCache();
    } catch (reason) {
      if (alive.current && revision === apiClient.getConnectionRevision())
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current && revision === apiClient.getConnectionRevision()) setSaving(false);
    }
  };
  return (
    <Card title={t('routing_profiles.title')}>
      <p className="hint">{t('routing_profiles.description')}</p>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {!loaded && (
        <Button onClick={() => setReload((v) => v + 1)} disabled={disabled}>
          {t('routing_profiles.reload')}
        </Button>
      )}
      <fieldset disabled={locked} className={styles.fieldset}>
        <div className={styles.toolbar}>
          <Select
            ariaLabel={t('routing_profiles.profile')}
            value={selected}
            disabled={locked}
            options={[
              { value: 'default', label: t('routing_profiles.master') },
              ...Object.keys(profiles)
                .filter((key) => key !== 'default')
                .sort()
                .map((key) => ({ value: key, label: key })),
            ]}
            onChange={setSelected}
          />
          <Input
            label={t('routing_profiles.new_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            disabled={
              locked ||
              !name.trim() ||
              name.trim() === 'default' ||
              Object.prototype.hasOwnProperty.call(profiles, name.trim())
            }
            onClick={() => {
              const next = name.trim();
              setProfiles((current) => ({ ...current, [next]: {} }));
              setSelected(next);
              setName('');
            }}
          >
            {t('routing_profiles.create')}
          </Button>
          {selected !== 'default' && (
            <Button
              variant="danger"
              disabled={locked}
              onClick={() => {
                setProfiles((current) =>
                  Object.fromEntries(Object.entries(current).filter(([key]) => key !== selected))
                );
                setSelected('default');
              }}
            >
              {t('routing_profiles.remove')}
            </Button>
          )}
        </div>
        <p className="hint">{t('routing_profiles.delete_hint')}</p>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={profile.allowedAuths !== undefined}
            onChange={(e) =>
              update({
                allowedAuths: e.target.checked ? [...(master.allowedAuths ?? ids)] : undefined,
              })
            }
          />
          {t('routing_profiles.restrict_accounts')}
        </label>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={profile.excludedModels !== undefined}
            onChange={(e) =>
              update({
                excludedModels: e.target.checked ? [...(master.excludedModels ?? [])] : undefined,
              })
            }
          />
          {t('routing_profiles.override_models')}
        </label>
        {profile.excludedModels !== undefined && (
          <label className={styles.textarea}>
            {t('routing_profiles.excluded_models')}
            <textarea
              className="input"
              rows={3}
              value={profile.excludedModels.join('\n')}
              onChange={(e) => update({ excludedModels: lines(e.target.value) })}
            />
          </label>
        )}
        <div className={styles.accounts}>
          {ids.map((id) => {
            const rule = profile.auths?.[id] ?? {};
            const inherited = selected === 'default' ? undefined : master.auths?.[id];
            const inheritedPriority =
              inherited?.priority ?? files.find((file) => file.name === id)?.priority ?? 0;
            return (
              <div key={id} className={styles.account}>
                <div className={styles.identity}>
                  {profile.allowedAuths !== undefined && (
                    <input
                      aria-label={t('routing_profiles.allow_account', { account: displayNameFor(id) })}
                      type="checkbox"
                      checked={profile.allowedAuths.includes(id)}
                      onChange={(e) =>
                        update({
                          allowedAuths: e.target.checked
                            ? [...profile.allowedAuths!, id]
                            : profile.allowedAuths!.filter((value) => value !== id),
                        })
                      }
                    />
                  )}
                  <strong>{displayNameFor(id)}</strong>
                </div>
                <Input
                  label={t('routing_profiles.priority')}
                  type="number"
                  step={1}
                  value={rule.priority ?? ''}
                  placeholder={t('routing_profiles.inherited_priority', {
                    priority: inheritedPriority,
                  })}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || Number.isSafeInteger(Number(value)))
                      updateAuth(id, { priority: value === '' ? undefined : Number(value) });
                  }}
                />
                <Select
                  ariaLabel={t('routing_profiles.account_status', { account: displayNameFor(id) })}
                  value={
                    rule.disabled === undefined ? 'inherit' : rule.disabled ? 'disabled' : 'enabled'
                  }
                  disabled={locked}
                  options={[
                    { value: 'inherit', label: t('routing_profiles.inherit') },
                    { value: 'enabled', label: t('routing_profiles.enabled') },
                    { value: 'disabled', label: t('routing_profiles.disabled') },
                  ]}
                  onChange={(value) =>
                    updateAuth(id, {
                      disabled: value === 'inherit' ? undefined : value === 'disabled',
                    })
                  }
                />
                <label className={styles.textarea}>
                  {t('routing_profiles.account_models')}
                  <textarea
                    className="input"
                    rows={2}
                    value={rule.excludedModels?.join('\n') ?? ''}
                    placeholder={inherited?.excludedModels?.join('\n') ?? ''}
                    onChange={(e) => updateAuth(id, { excludedModels: lines(e.target.value) })}
                  />
                </label>
                {rule.excludedModels !== undefined && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={locked}
                    onClick={() => updateAuth(id, { excludedModels: undefined })}
                  >
                    {t('routing_profiles.inherit_models')}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <div className={styles.toolbar}>
          <Input
            label={t('routing_profiles.add_account')}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
          <Button
            disabled={locked || !account.trim()}
            onClick={() => {
              updateAuth(account.trim(), {});
              setAccount('');
            }}
          >
            {t('routing_profiles.add')}
          </Button>
        </div>
        <p className="hint">{t('routing_profiles.priority_hint')}</p>
        <div className={styles.toolbar}>
          <Button onClick={() => void save()} disabled={locked || !dirty}>
            {t('routing_profiles.save')}
          </Button>
          <Button
            variant="secondary"
            disabled={locked || !dirty}
            onClick={() => {
              setProfiles(JSON.parse(saved) as RoutingProfiles);
              setSelected('default');
              setError('');
            }}
          >
            {t('routing_profiles.discard')}
          </Button>
        </div>
      </fieldset>
    </Card>
  );
}
