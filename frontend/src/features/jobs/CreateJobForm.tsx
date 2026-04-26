import { useRef, useState, type FormEvent } from 'react';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Input from '../../components/Input';
import { ApiError } from '../../lib/api-client';
import { useCreateJob } from './jobs.hooks';

const MAX_NAME = 200;

export default function CreateJobForm() {
  const [name, setName] = useState('');
  const [clientError, setClientError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = useCreateJob();

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && name.length <= MAX_NAME;

  const fieldError =
    mutation.error instanceof ApiError ? mutation.error.fieldError('name') : undefined;
  const inputError = clientError ?? fieldError;

  // Show ErrorBanner only for non-field errors (network, 5xx, etc).
  const bannerError =
    mutation.error && !(mutation.error instanceof ApiError && fieldError !== undefined)
      ? mutation.error
      : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) {
      setClientError('Name cannot be empty');
      return;
    }
    setClientError(undefined);
    mutation.mutate(trimmed, {
      onSuccess: () => {
        setName('');
        inputRef.current?.focus();
      },
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3" aria-label="Create job">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
        <Input
          ref={inputRef}
          label="New job name"
          name="name"
          maxLength={MAX_NAME}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (clientError) setClientError(undefined);
          }}
          placeholder="e.g. Fluid Dynamics Simulation"
          error={inputError}
          className="md:flex-1"
        />
        <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!valid}>
          Create job
        </Button>
      </div>
      <ErrorBanner error={bannerError} />
    </form>
  );
}
