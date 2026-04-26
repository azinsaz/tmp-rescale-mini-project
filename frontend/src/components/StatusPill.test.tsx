import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusPill from './StatusPill';
import { STATUS_VALUES } from '../features/jobs/jobs.types';

describe('StatusPill', () => {
  it.each(STATUS_VALUES)('renders %s with the correct accessible name', (state) => {
    render(<StatusPill state={state} />);
    expect(screen.getByRole('status', { name: state })).toBeInTheDocument();
    expect(screen.getByText(state)).toBeInTheDocument();
  });

  it('renders an inline SVG glyph', () => {
    const { container } = render(<StatusPill state="RUNNING" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
