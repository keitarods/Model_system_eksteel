# Ferramentas de chapa

O grupo **Chapas** reúne conversão/espessura, Face, Recorte, Flange, Planificar, Desdobrar e Redobrar. Furos, padrões, arredondamentos e chanfros continuam nos grupos gerais de modelagem.

- **Planificar / Ver dobrada**: visualização temporária; não cria operação no histórico. Disponível também para chapa plana com sólido, sem exigir flange.
- **Desdobrar**: registra no histórico a abertura de todas as flanges nativas da chapa. Exige uma chapa com flange. A face base mantém a referência usada pelo motor atual.
- **Redobrar**: após Desdobrar, restaura as dobras e registra a operação. Ambos são salvos no projeto e participam de undo/redo.
- **Flange**: comprimento, ângulo, raio interno e fator K editáveis. Raio vazio acompanha a espessura; fator K padrão 0,5. Os valores antigos permanecem compatíveis.
- **Recorte**: atalho para subtrair o perfil fechado na espessura da chapa, no estado dobrado.

## Limitações

Desdobrar/Redobrar nesta versão operam sobre a chapa inteira, sem seleção parcial de dobras. Não implementam o fluxo de cortar uma dobra aberta e transportar esse corte para a dobra fechada: adicionar operações entre Desdobrar e Redobrar é recusado explicitamente. Para continuar modelando, redobre primeiro. Planificar é apenas visualização e não desfaz uma operação Desdobrar do histórico.

Corpos STEP precisam de flanges nativas reconstruídas com dados suficientes de espessura, raio e fator K. Não se infere um desenvolvimento de fabricação confiável de um sólido arbitrário. Bainha, flange de contorno, alívios automáticos e redobramento de cortes sobre a zona curva ainda não foram implementados.
