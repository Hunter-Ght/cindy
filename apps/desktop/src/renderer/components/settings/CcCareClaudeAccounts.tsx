/**
 * 本地定制(CC Care):Claude 账号由 CC Care 环境决定时,替代上游订阅账号列表。
 * 不提供添加 / 登录 / 移出 / 调度设置;只显示 CC Care 当前环境的账号与额度。
 * 文案放在本文件,避免改动上游的多语言文件(同步上游时少冲突)。
 */
import { UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubscriptionPoolView } from '../../../shared/subscriptionAccounts';

const TEXT = {
  zh: {
    note: 'Claude 账号由 CC Care 管理。添加或切换账号请在 CC Care 中切换环境；Cindy 不另外登录 Claude 账号。',
    environment: '当前环境：',
    none: 'CC Care 没有正在使用的环境',
  },
  en: {
    note: 'Claude accounts are managed by CC Care. To add or switch accounts, switch environments in CC Care; Cindy does not sign in to Claude accounts itself.',
    environment: 'Current environment: ',
    none: 'No CC Care environment is in use',
  },
};

export function ccCareText(language: string | undefined) {
  return language?.startsWith('zh') ? TEXT.zh : TEXT.en;
}

export function CcCareClaudeAccounts({
  view,
  defaultUsage,
}: {
  view: SubscriptionPoolView;
  defaultUsage?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const text = ccCareText(i18n?.resolvedLanguage ?? i18n?.language);
  const account = view.accounts.find((item) => item.id === 'default');
  const signedIn = account?.status === 'ready' || account?.status === 'limited';
  return (
    <section
      className="border-t border-[var(--border-default)] px-5 py-5"
      data-testid="subscription-accounts"
    >
      <h3 className="text-16 font-medium text-[var(--text-primary)]">
        {t('subscriptionAccounts.title')}
      </h3>
      <p className="mt-2 text-12 leading-relaxed text-[var(--text-secondary)]">{text.note}</p>
      <div className="mt-4 flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-chip)] text-[var(--text-secondary)]">
          <UserRound size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-all text-13 font-medium text-[var(--text-primary)]">
              {view.ccCare?.environment
                ? `${text.environment}${view.ccCare.environment}`
                : text.none}
            </span>
            {account?.plan && (
              <span className="text-11 text-[var(--text-tertiary)]">{account.plan}</span>
            )}
          </div>
          {account && (
            <p className="mt-1 break-all text-12 text-[var(--text-secondary)]">
              {signedIn && account.identity ? `${account.identity} · ` : ''}
              {t(
                `subscriptionAccounts.${account.status === 'signed-out' ? 'signedOut' : account.status}`,
              )}
            </p>
          )}
        </div>
      </div>
      {defaultUsage && (
        <div data-testid="provider-usage-module" className="-mx-4 mt-2">
          {defaultUsage}
        </div>
      )}
    </section>
  );
}
