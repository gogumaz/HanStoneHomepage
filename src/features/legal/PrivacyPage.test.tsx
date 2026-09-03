import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

describe('PrivacyPage', () => {
  it('discloses purpose, retention, withdrawal, and a child-friendly notice', () => {
    render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '개인정보 처리 안내' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('법정대리인 동의 요청')).toBeInTheDocument();
    expect(within(table).getByText(/초대 수락·만료·철회 시 연락처 즉시 삭제/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '열람·정정·삭제·동의 철회' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '내 정보는 이렇게 지켜요' })).toBeInTheDocument();
    expect(screen.getByText(/동의하기 전에는 학습을 시작할 수 없어요/)).toBeInTheDocument();
    expect(screen.getByText(/승인 전 운영 배포를 허용하지 않습니다/)).toBeInTheDocument();
  });
});
