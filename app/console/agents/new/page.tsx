import Link from 'next/link';
import { createAgentAction } from '../actions';
import { bundleVerifiedLabel } from '@/lib/auth/bundle';

/** Create-agent form (T14 / Lane E). Submits → DRAFT agent → redirect to its configure page. */
export default function NewAgentPage() {
  return (
    <section className="mx-auto max-w-xl">
      <Link href="/console/agents" className="text-sm text-gray-500 hover:underline">
        ← Agents
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Create a triage agent</h1>
      <p className="mt-1 text-sm text-gray-600">
        Name it and pick a language. You&apos;ll choose channels and publish on the next step.
      </p>

      <form action={createAgentAction} className="mt-6 space-y-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-gray-700">Agent name</span>
          <input
            type="text"
            name="name"
            required
            placeholder="After-hours triage"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-gray-700">Default language</span>
          <select name="language" defaultValue="EN" className="rounded-md border border-gray-300 px-3 py-2">
            <option value="EN">English</option>
            <option value="ES">Español</option>
          </select>
        </label>

        {/* Policy-bundle selector ships as tk-0017 — until then the signed DEFAULT bundle is used. */}
        <div className="rounded-md bg-gray-50 p-3 text-sm">
          <span className="font-medium text-gray-700">Policy bundle</span>
          <p className="mt-0.5 text-gray-600">
            {bundleVerifiedLabel()} <span className="text-gray-400">(selector coming in tk-0017)</span>
          </p>
        </div>

        <button
          type="submit"
          className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800"
        >
          Create and configure
        </button>
      </form>
    </section>
  );
}
