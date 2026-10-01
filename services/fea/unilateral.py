"""Small-sliding planar frictionless contact, unilateral nodal penalty.

Each active nodal constraint is represented by a linear SPRINGA on an auxiliary
relative-normal DOF. The service updates the active set and load increment.
Bodies or permanently bonded groups must be restrained with unilateral contacts
open; no weak springs are used.
"""
import time
import numpy as np


def states(interfaces, displacement):
    return [np.array([gap+b['normal']@(displacement[s]-w@displacement[m])
        for (s,m,w),gap in zip(b['mappings'],b['gaps'])]) for b in interfaces]


def spring_lines(mesh, interfaces, active):
    count=sum(int(np.count_nonzero(a)) for a in active)
    if not count:return [],[],[]
    first=len(mesh['nodes'])+1;reference=first+count
    length=max(float(np.linalg.norm(np.ptp(mesh['nodes'],axis=0))),1.)
    lines=['*NODE',f'{reference},0.,0.,0.'];boundaries=[f'{reference},1,3'];loads=[]
    aux=first;records=[]
    for bond,mask in zip(interfaces,active):
        for i,((slave,masters,weights),on) in enumerate(zip(bond['mappings'],mask)):
            if not on:continue
            lines.append(f'{aux},{length:.10e},0.,0.')
            stiffness=bond['normalStiffness']*bond['areas'][i]
            terms=[f'{aux},1,1.']
            terms += [f'{slave+1},{axis+1},{-value:.10e}' for axis,value in enumerate(bond['normal']) if abs(value)>1e-14]
            terms += [f'{master+1},{axis+1},{value*weight:.10e}' for master,weight in zip(masters,weights) for axis,value in enumerate(bond['normal']) if abs(value*weight)>1e-14]
            records += ['*EQUATION',str(len(terms))]+[', '.join(terms[j:j+4]) for j in range(0,len(terms),4)]
            records += [f'*ELEMENT,TYPE=SPRINGA,ELSET=CONTACT{aux}',f'{len(mesh["tetrahedra"])+aux-first+1},{reference},{aux}',f'*SPRING,ELSET=CONTACT{aux}','',f'{stiffness:.10e}']
            boundaries.append(f'{aux},2,3')
            # Linearization of p = k max(-(gap0 + relative displacement), 0).
            if bond['gaps'][i]:loads.append(f'{aux},1,{-stiffness*bond["gaps"][i]:.10e}')
            aux+=1
    return lines+records,boundaries,loads


def solve_incremental(mesh, interfaces, run_linear, time_limit=180):
    start=time.monotonic();history=[];u=np.zeros((len(mesh['nodes']),3))
    load=0.;step=.25;attempts=0
    while load<1-1e-12:
        target=min(1.,load+step);active=[g<=0 for g in states(interfaces,u)];seen=set();completed=False
        for iteration in range(1,31):
            remaining=time_limit-(time.monotonic()-start)
            if remaining<=0:raise ValueError('Contato excedeu o tempo de solução. Simplifique a malha.')
            key=tuple(a.tobytes() for a in active)
            if key in seen:break
            seen.add(key)
            trial=run_linear(target,active,remaining)
            gaps=states(interfaces,trial)
            next_active=[g<0 for g in gaps]
            # Zero-gap nodes exert no force, whichever branch is selected.
            stable=all(np.all((a==b)|(np.abs(g)<1e-10)) for a,b,g in zip(active,next_active,gaps))
            if stable:
                u=trial;load=target;completed=True
                history.append({'loadFactor':load,'iterations':iteration,'activePoints':sum(int(np.count_nonzero(g < -1e-10)) for g in gaps)})
                break
            active=next_active
        attempts+=1
        if not completed:
            step/=2
            if step<1/1024 or attempts>100:
                raise ValueError('O contato não convergiu. Reveja apoios, rigidez normal e refinamento.')
        elif len(history)>100:
            raise ValueError('Contato excedeu o limite de incrementos.')
    return u,history


def recover_unilateral(interfaces, residual, uncertainty, displacement, precision, mesh_size):
    contact_forces=np.zeros_like(residual);bound=uncertainty.copy();reports=[]
    for bond,gaps in zip(interfaces,states(interfaces,displacement)):
        normal=bond['normal'];force_sum=np.zeros(3);peak=0.;energy=0.;slip=0.
        for i,((slave,masters,weights),gap) in enumerate(zip(bond['mappings'],gaps)):
            pressure=bond['normalStiffness']*max(-gap,0.)
            stiffness=bond['normalStiffness']*bond['areas'][i]
            force=pressure*bond['areas'][i]*normal
            contact_forces[slave]+=force;contact_forces[masters]-=weights[:,None]*force
            force_sum+=force;peak=max(peak,pressure);energy+=stiffness*max(-gap,0.)**2/2
            relative=displacement[slave]-weights@displacement[masters]
            slip=max(slip,float(np.linalg.norm(relative-normal*(relative@normal))))
            # The positive-part function is Lipschitz even at opening/closure.
            force_error=stiffness*(np.abs(normal)@(precision[slave]+np.abs(weights)@precision[masters]))
            bound[slave]+=np.abs(normal)*force_error
            bound[masters]+=np.abs(weights)[:,None]*np.abs(normal)*force_error
        penetration=max(0.,float(-min(gaps)));opening=max(0.,float(max(gaps)))
        if penetration>mesh_size*.01:
            raise ValueError('Penetração de contato acima de 1% do tamanho global. Aumente a rigidez normal e verifique a malha.')
        if slip>mesh_size*.05:
            raise ValueError('Deslizamento acima do limite de pequenos deslizamentos (5% do tamanho global). Esta formulação não acompanha grandes movimentos tangenciais.')
        reports.append({'id':bond['id'],'kind':'frictionless','bondedNodes':0,'contactPoints':len(gaps),
            'activePoints':int(np.count_nonzero(gaps < -1e-10)),'maxInitialGap':bond['maxInitialGap'],
            'maxRelativeDisplacement':max(float(np.linalg.norm(displacement[s]-w@displacement[m])) for s,m,w in bond['mappings']),
            'maxOpening':opening,'maxPenetration':penetration,'maxPressure':peak,'contactEnergy':energy,
            'maxTangentialSlip':slip,'slaveForce':force_sum.tolist(),'masterForce':(-force_sum).tolist()})
    return residual-contact_forces,bound,contact_forces,reports
