import PageHeader, { Empty } from '../components/PageHeader';
import RetainerCard from '../components/RetainerCard';
import { useBusinesses } from '../components/BusinessSelector';

export default function ClientsPage({ role, profile }) {
  const { businesses, selected, selectedId } = useBusinesses();

  const visible = selectedId === 'all' ? businesses : (selected ? [selected] : []);

  return (
    <div>
      <PageHeader
        kicker="Work"
        title={role === 'client' ? 'My Retainer' : 'Clients'}
        subtitle={
          selected
            ? `Retainer status for ${selected.name}.`
            : role === 'client'
              ? 'All of your businesses and their retainer status.'
              : 'Every retainer and their current status.'
        }
      />
      {visible.length === 0 ? (
        <Empty>No businesses to show.</Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map(b => <RetainerCard key={b.id} business={b} />)}
        </div>
      )}
    </div>
  );
}
