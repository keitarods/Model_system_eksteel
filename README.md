# Model_system_eksteel

Modelador CAD com Next.js, React Three Fiber, Zustand e Replicad/OpenCascade.

- Desenvolvimento: `npm run dev`
- Testes de geometria, histórico e exportação WASM: `npm test`
- Tipagem: `npm run typecheck`
- Produção: `npm run build`

Veja [a revisão CAD e o changelog](docs/CAD_REVIEW.md) para inventário de ferramentas, uso das ferramentas de esboço, splines, simetria, cotas, camadas, loft/shell e intercâmbio DXF/STEP/STL, limitações e prioridades de paridade com o Inventor.

Para abrir STEP/STL/GLB e salvar em `.eks3d`, veja [o guia de conversão 3D](docs/IMPORT_3D.md). IPT/IAM precisam ser exportados para STEP previamente; o conversor não recupera o histórico paramétrico original.

Reconhecimento assistido de extrusão/furos, revolução e chapa: [guia e limites](docs/RECONSTRUCTION.md). Chapa dobrada exige dados explícitos de fabricação; ausência ou divergência retorna erro.

### Projetos no banco do cliente

O Modelador oferece **Projetos na nuvem** com conectores para Supabase Storage, PostgreSQL, MySQL e SQL Server, pastas e versões nativas `.eks3d`. Consulte [configuração, scripts e limites](docs/CLOUD_PROJECTS.md). Conexões SQL exigem autenticação, TLS, destinos autorizados no servidor e preparação das tabelas.
