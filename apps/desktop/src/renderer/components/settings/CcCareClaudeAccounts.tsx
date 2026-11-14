/**
 * 本地定制(CC Care):Claude 账号由 CC Care 环境决定。每个环境是一个 Claude 单独供应商;
 * 账号区沿用上游,只隐藏添加 / 登录 / 移出(交给 CC Care),这里提供那一行说明。
 * 文案放在本文件,避免改动上游的多语言文件(同步上游时少冲突)。
 */
import { useTranslation } from 'react-i18next';

const TEXT = {
  zh: {
    note: 'Claude 账号由 CC Care 管理：每个 CC Care 环境是一个单独的 Claude 供应商，内置供应商跟随 CC Care 当前环境。添加、登录或删除账号请在 CC Care 中新建或删除环境；Cindy 不另外登录 Claude 账号。',
  },
  en: {
    note: 'Claude accounts are managed by CC Care: each CC Care environment is a separate Claude provider, and the built-in provider follows the environment CC Care is using. To add, sign in to or remove an account, create or delete an environment in CC Care; Cindy does not sign in to Claude accounts itself.',
  },
};

export function ccCareText(language: string | undefined) {
  return language?.startsWith('zh') ? TEXT.zh : TEXT.en;
}

export function CcCareAccountsNote() {
  const { i18n } = useTranslation();
  return (
    <p className="mt-2 text-12 leading-relaxed text-[var(--text-secondary)]">
      {ccCareText(i18n?.resolvedLanguage ?? i18n?.language).note}
    </p>
  );
}
