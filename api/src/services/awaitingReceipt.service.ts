/**
 * Purchase orders with goods still to come in: issued, or part-received with a
 * balance still due. Stores can receive against any of them.
 *
 * The Deliveries page lists exactly these. The stores officer's "Deliveries
 * pending receipt" item, the Pending Deliveries figure and the sidebar badge
 * count with the same filter, so the number always matches the list it opens.
 * They once left out a part-received order whose balance the supplier had not
 * yet shipped, after the list had started to include it.
 */
export function awaitingReceiptFilter(): Record<string, unknown> {
  return {
    status: { $in: ['issued', 'partially_received'] },
    isDeleted: false
  };
}
