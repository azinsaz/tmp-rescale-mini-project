import { afterEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render';
import { clearFetchMock, mockFetchOnce, mockResponse } from '../../test-utils/mockFetch';
import CreateJobForm from './CreateJobForm';

describe('CreateJobForm', () => {
  afterEach(clearFetchMock);

  it('disables submit on empty input', () => {
    renderWithProviders(<CreateJobForm />);
    expect(screen.getByRole('button', { name: /create job/i })).toBeDisabled();
  });

  it('treats whitespace-only as empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateJobForm />);
    await user.type(screen.getByLabelText(/new job name/i), '   ');
    expect(screen.getByRole('button', { name: /create job/i })).toBeDisabled();
  });

  it('flips to error variant when API returns 400 with name-loc error', async () => {
    mockFetchOnce(
      mockResponse({
        status: 400,
        body: {
          detail: 'Validation failed',
          errors: [{ loc: ['body', 'name'], msg: 'Name cannot be empty', type: 'value_error' }],
        },
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateJobForm />);
    await user.type(screen.getByLabelText(/new job name/i), 'X');
    await user.click(screen.getByRole('button', { name: /create job/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/new job name/i)).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByText('Name cannot be empty')).toBeInTheDocument();
  });

  it('clears input and refocuses on success', async () => {
    mockFetchOnce(
      mockResponse({
        status: 201,
        body: {
          id: 1,
          name: 'Sim A',
          current_status: 'PENDING',
          created_at: '2026-04-25T10:00:00Z',
          updated_at: '2026-04-25T10:00:00Z',
        },
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateJobForm />);
    const input = screen.getByLabelText(/new job name/i) as HTMLInputElement;
    await user.type(input, 'Sim A');
    await user.click(screen.getByRole('button', { name: /create job/i }));
    await waitFor(() => expect(input.value).toBe(''));
    expect(input).toHaveFocus();
  });
});
