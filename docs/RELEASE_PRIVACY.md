# Publicação e arquivos privados

Os scripts SQL de provisionamento são mantidos localmente e ignorados pelo Git. Guarde uma cópia segura separada; eles não serão recuperados ao clonar este repositório. A aplicação requer um banco previamente preparado pelo administrador. A ação administrativa de preparar banco só funciona quando os scripts privados estão presentes no servidor; o build inclui esses arquivos somente quando seus diretórios estão disponíveis.

Também ficam fora do Git: `.env*` reais, `.cad-config/`, certificados PEM, chaves privadas e dumps SQL. Exemplos de ambiente são públicos e devem conter apenas placeholders. `.gitignore` não protege arquivos já publicados, nem uploads manuais de pastas completas.

O frontend de uma aplicação web é entregue ao navegador. O repositório contém o código do produto, inclusive nomes de tabelas e consultas usados pelos conectores. Excluir scripts SQL não torna esses nomes secretos. Para preservar o código comercial, mantenha o repositório privado e limite seu acesso.

Antes de publicar: execute typecheck, testes, build e auditoria de dependências. A ausência de padrões de segredos numa varredura não garante ausência absoluta de informação confidencial. Verifique também variáveis e arquivos configurados na hospedagem.

Os testes de provisionamento são ignorados explicitamente em clones sem os scripts privados; os demais testes continuam disponíveis.
