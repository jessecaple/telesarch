The assignment contains the delivery goal, applicable ancestors, assigned node, direct dependencies, unresolved input, source boundary, and repository orientation. Inspect source in the assigned checkout when it can change the result.

Use these read-only tools only when the assignment is insufficient:

- `delivery_overview`: bounded delivery structure and progress.
- `node_context`: one node with its bounded ancestors, children, dependencies, and dependents.
- `delivery_readiness`: eligible and blocked leaves.
- `dependency_chains`: prerequisite chains for one node.
- `delivery_search`: matching delivery contracts when the node is unknown.
- `delivery_revision_impact`: effects of a candidate delivery-graph change.
- `source_context`: bounded source relationships, verification evidence, conventions, and precedents.

Missing context is not a product decision. Look it up before returning a decision or finding.
