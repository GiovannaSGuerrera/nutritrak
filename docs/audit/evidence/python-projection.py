"""Audit-only: execute the original DTO function without importing DB/framework."""
import ast
from pathlib import Path
from types import SimpleNamespace

root = Path(__file__).resolve().parents[3]
source = root / 'apps/api-python/app/main.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'patient_dto')
namespace = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
patient = SimpleNamespace(
    id='synthetic', workspace_id='ws', created_by='user', name='Synthetic',
    email='', phone='', birth_date='', status='ativo',
    profile={'objective': 'synthetic objective', 'clinicalNotes': 'SYNTHETIC_CONFIDENTIAL'},
)
result = namespace['patient_dto'](patient, False)
assert result.get('clinicalNotes') == 'SYNTHETIC_CONFIDENTIAL'
assert 'objective' not in result
print({'test': 'python_administrative_projection', 'clinicalNotes_exposed': True, 'objective_exposed': False})
for file in (root / 'apps/api-python').rglob('*.py'):
    ast.parse(file.read_text(encoding='utf-8'))
print('Python AST: all source/test/migration files parsed')
